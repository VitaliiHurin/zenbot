#!/usr/bin/env node
var request = require('micro-request')
request('https://btc-e.com/api/3/info', {headers: {'User-Agent': 'zenbot/4'}}, function (err, resp, body) {
  if (err) throw err
  if (resp.statusCode !== 200) {
    let err = new Error('non-200 status: ' + resp.statusCode)
    err.code = 'HTTP_STATUS'
    err.body = body
    console.error(err)
    process.exit(1)
  } 
  let pairs = JSON.parse(body).pairs
  console.log(pairs)
  if (typeof pairs === 'undefined') {
    let err = new Error('response is broken')
    err.code = resp.statusCode
    err.body = body
    console.error(err)
    process.exit(1)
  }
  var products = []
  Object.keys(pairs).forEach(function(pair) {
    products.push({
      asset: pair.substring(0, 3).toUpperCase(),
      currency: pair.substring(4, 7).toUpperCase(),
      min_size: pairs[pair].min_price.toString(),
      max_size: pairs[pair].max_price.toString(),
      increment: (1 / Math.pow(10, pairs[pair].decimal_places)).toString(),
      label: pair.substring(0, 3).toUpperCase() + '/' + pair.substring(4, 7).toUpperCase()
    })
  })
  let target = require('path').resolve(__dirname, 'products.json')
  require('fs').writeFileSync(target, JSON.stringify(products, null, 2))
  console.log('wrote', target)
  process.exit()
})
