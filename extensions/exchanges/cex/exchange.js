const cexapi = require('./cexapi.js')
var _ = require('lodash')
  , path = require('path')
  , moment = require('moment')
  , n = require('numbro')

module.exports = function container (get, set, clear) {
  var c = get('conf')

  if (!c.cex || !c.cex.key || c.cex.key === 'YOUR-API-KEY') {
    throw new Error('please configure your CEX credentials in ' + path.resolve(__dirname, 'conf.js'))
  }
  cexapi.create(c.cex.user, c.cex.key, c.cex.secret)

  function joinProduct (product_id) {
    return product_id.split('-')[0] + '/' + product_id.split('-')[1]
  }

  function retry (method, args) {
    if (method !== 'getTrades') {
      console.error(('\nCEX API is down! unable to call ' + method + ', retrying in 3s').red)
    }
    setTimeout(function () {
      exchange[method].apply(exchange, args)
    }, 3000)
  }

  var orders = {}
  var exchange = {
    name: 'cex',
  //  historyScan: 'forward',
    makerFee: 0,
    takerFee: 0.2,

    getProducts: function () {
      return require('./products.json')
    },

    getTrades: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      // if (opts.from) {
      //   args.since = opts.from
      // }
      // if (opts.to) {
      //   args.end = opts.to
      // }
      // if (args.since && !args.end) {
      //   // add 2 hours
      //   args.end = args.since + 7200
      // }
      // else if (args.end && !args.since) {
      //   // subtract 2 hours
      //   args.since = args.end - 7200
      // }
      cexapi.trade_history(null, joinProduct(opts.product_id), function (data) {
        if (typeof data === 'string') {
          console.error('getTrades ', data)
          return retry('getTrades', func_args)
        }
        // var trades = []
        // Object.keys(data).forEach(function (i) {
        //     trades.push({
        //       trade_id: i,
        //       time: moment.unix(data[i].date).valueOf(),
        //       size: Number(data[i].amount),
        //       price: Number(data[i].rate),
        //       side: data[i].type
        //     })
        // })
        var trades = data.map(function(trade) {
          return {
            trade_id: trade.tid,
            time: moment.unix(trade.date).valueOf(),
            size: Number(trade.amount),
            price: Number(trade.price),
            side: trade.type
          }
        })
        cb(null, trades)
      })
    },

    getBalance: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      cexapi.balance(function (data) {
        //console.log('getBalance ', data)
        if (typeof data === 'string') {
          return retry('getBalance', func_args)
        }
        var balance = {asset: 0, currency: 0}
        if (data[opts.currency]) {
          balance.currency = n(data[opts.currency].available).add(data[opts.currency].orders).format('0.00000000')
          balance.currency_hold = 0
        }
        if (data[opts.asset]) {
          balance.asset = n(data[opts.asset].available).add(data[opts.asset].orders).format('0.00000000')
          balance.asset_hold = 0
        }
        cb(null, balance)
      })
    },

    getQuote: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      cexapi.ticker(joinProduct(opts.product_id), function (data) {
        //console.log('getQuote ', data)
        if (typeof data === 'string') {
          return retry('getQuote', func_args)
        }
        cb(null, { bid : data.bid, ask : data.ask })
      })
    },

    cancelOrder: function (opts, cb) {
      var args = [].slice.call(arguments)
      cexapi.cancel_order(opts.order_id, function (data) {
        //console.log('cancelOrder ', data)
        if (data !== true) {
          return retry('cancelOrder', args)
        }
        cb()
      })
    },

    trade: function (type, opts, cb) {
      var args = [].slice.call(arguments)
      cexapi.place_order(type, opts.size, opts.price, joinProduct(opts.product_id), function (data) {
        //console.log('trade ', data)
        if (typeof data === 'string') {
          return retry('trade', args)
        }
        var currentTime = new Date().getTime()
        var order = {
          id: data.id === 0 ? Math.round(currentTime / 1000) : data.id,
          status: data.id === 0 ? 'done' : 'open',
          price: opts.price,
          size: opts.size,
          post_only: !!opts.post_only,
          created_at: currentTime,
          filled_size: n(opts.size).subtract(data.pending).format('0.00000000')
        }
        // if (err) {
        //   console.error(('\nAddOrder error:').red)
        //   console.error(err)
        //   order.status = 'rejected'
        //   order.reject_reason = err.message
        //   return cb(null, order)
        // }
        orders['~' + order.id] = order
        cb(null, order)
      })
    },

    buy: function (opts, cb) {
      exchange.trade('buy', opts, cb)
    },

    sell: function (opts, cb) {
      exchange.trade('sell', opts, cb)
    },

    getOrder: function (opts, cb) {
      var args = [].slice.call(arguments)
      var order = orders['~' + opts.order_id]
      if (!order) return cb(new Error('order not found in cache'))
      cexapi.api_call('get_order', {id: opts.order_id}, 1, joinProduct(opts.product_id), function (data) {
        //console.log('getOrder ', data)
        if (typeof data === 'string') {
          return retry('getQuote', func_args)
        }
        switch (data.status) {
          case 'a': // active
            break;
          case 'd': // done
            order.status = 'done'
            order.done_at = new Date().getTime()
            break;
          case 'c': // cancelled
            order.status = 'rejected'
            order.done_at = new Date().getTime()
            break;
          case 'cd': // cancelled but partially done
            order.status = 'done'
            order.done_at = new Date().getTime()
            order.filled_size = n(data.amount).subtract(data.remains).format('0.00000000')
            break;
        }
        cb(null, order)
      })
    },

    // return the property used for range querying.
    //getCursor: function (trade) {
    //  return trade.trade_id
    //}
    getCursor: function (trade) {
     return Math.floor((trade.time || trade) / 1000)
    }
  }
  return exchange
}
