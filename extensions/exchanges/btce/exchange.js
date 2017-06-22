const BTCE = require('btce')
var _ = require('lodash')
  , path = require('path')
  , moment = require('moment')
  , n = require('numbro')

module.exports = function container (get, set, clear) {
  var c = get('conf')

  var public_client, authed_client

  function publicClient () {
    if (!public_client) public_client = new BTCE(null, null)
    return public_client
  }

  function authedClient () {
    if (!authed_client) {
      if (!c.btce || !c.btce.key || c.btce.key === 'YOUR-API-KEY') {
        throw new Error('please configure your BTCE credentials in ' + path.resolve(__dirname, 'conf.js'))
      }
      authed_client = new BTCE(c.btce.key, c.btce.secret)
    }
    return authed_client
  }

  function joinProduct (product_id) {
    return product_id.split('-')[0].toLowerCase() + '_' + product_id.split('-')[1].toLowerCase()
  }

  function retry (method, args) {
    if (method !== 'getTrades') {
      console.error(('\nBTCE API is down! unable to call ' + method + ', retrying in 10s').red)
    }
    setTimeout(function () {
      exchange[method].apply(exchange, args)
    }, 2100)
  }

  var orders = {}
  var exchange = {
    name: 'btce',
  //  historyScan: 'forward',
    makerFee: 0.2,
    takerFee: 0.2,

    getProducts: function () {
      return require('./products.json')
    },

    getTrades: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      var client = authedClient()
      var args = {
        pair: joinProduct(opts.product_id),
        limit: 1000
      }
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
      client.trades(args, function (err, data) {
        if (err || typeof data === 'string') {
          return retry('getTrades', func_args, err)
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
            side: trade.trade_type === 'bid' ? 'buy' : 'sell'
          }
        })
        cb(null, trades)
      })
    },

    getBalance: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      var client = authedClient()
      client.getInfo(function (err, data) {
        if (err || typeof data === 'string') {
          return retry('getBalance', func_args, err)
        }
        var balance = {asset: 0, currency: 0}
        if (data.funds[opts.currency]) {
          balance.currency = n(body[opts.currency].available).add(body[opts.currency].onOrders).format('0.00000000')
          balance.currency_hold = 0
        }
        if (data.funds[opts.asset]) {
          balance.asset = n(body[opts.asset].available).add(body[opts.asset].onOrders).format('0.00000000')
          balance.asset_hold = 0
        }
        cb(null, balance)
      })
    },

    getQuote: function (opts, cb) {
      var func_args = [].slice.call(arguments)
      var client = publicClient()
      var args = {
        pair: joinProduct(opts.product_id)
      }
      client.ticker(args, function (err, data) {
        if (err || typeof data === 'string') {
          return retry('getQuote', func_args, err)
        }
        cb(null, { bid : data.ticker.buy, ask : data.ticker.sell })
      })
    },

    cancelOrder: function (opts, cb) {
      var args = [].slice.call(arguments)
      var client = authedClient()
      client.cancelOrder(opts.order_id, function (err, data) {
        if (err || typeof data === 'string') {
          return retry('cancelOrder', args, err)
        }
        cb()
      })
    },

    trade: function (type, opts, cb) {
      var args = [].slice.call(arguments)
      var client = authedClient()
      var params = {
        pair: joinProduct(opts.product_id),
        type: type,
        rate: opts.price,
        amount: (opts.order_type === 'taker' ? 0.1 : opts.size)
      }
      client.trade(params, function (err, data) {
        if (typeof data === 'string') {
          return retry('trade', args)
        }
        var currentTime = new Date().getTime()
        var order = {
          id: data.order_id === 0 ? client.getTimestamp(currentTime) : data.order_id,
          status: data.order_id === 0 ? 'done' : 'open',
          price: opts.price,
          //size: n(data.remains).add(data.received).format('0.00000000'),
          size: opts.size,
          post_only: !!opts.post_only,
          created_at: currentTime,
          filled_size: data.received
        }
        if (err) {
          console.error(('\nAddOrder error:').red)
          console.error(err)
          order.status = 'rejected'
          order.reject_reason = err.message
          return cb(null, order)
        }
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
      var client = authedClient()
      var params = {
        order_id: opts.order_id
      }
      client.query('OrderInfo', params, function (err, data) {
        if (err || typeof data === 'string') {
          return retry('getQuote', func_args, err)
        }
        switch (data.status) {
          case 0: // active
            break;
          case 1: // done
            order.status = 'done'
            order.done_at = new Date().getTime()
            break;
          case 2: // cancelled
            order.status = 'rejected'
            order.done_at = new Date().getTime()
            break;
          case 3: // cancelled but partially done
            order.status = 'done'
            order.done_at = new Date().getTime()
            order.filled_size = data.start_amount - data.amount
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
