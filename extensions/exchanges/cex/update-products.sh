#!/usr/bin/env node
var request = require('micro-request')
request('https://cex.io/api/currency_limits', {headers: {'User-Agent': 'zenbot/4'}}, function (err, resp, body) {
  if (err) throw err
  if (resp.statusCode !== 200) {
    let err = new Error('non-200 status: ' + resp.statusCode)
    err.code = 'HTTP_STATUS'
    err.body = body
    console.error(err)
    process.exit(1)
  } 
  let pairs = body.data.pairs
  console.log(pairs)
  if (typeof pairs === 'undefined') {
    let err = new Error('response is broken')
    err.code = resp.statusCode
    err.body = body
    console.error(err)
    process.exit(1)
  }
  var products = []
  Object.keys(pairs).forEach(function(i) {
    products.push({
      asset: pairs[i].symbol1.toString(),
      currency: pairs[i].symbol2.toString(),
      min_size: "0.1",
      max_size: "1000",
      increment: "0.0001",
      label: pairs[i].symbol1 + '/' + pairs[i].symbol2
    })
  })
  let target = require('path').resolve(__dirname, 'products.json')
  require('fs').writeFileSync(target, JSON.stringify(products, null, 2))
  console.log('wrote', target)
  process.exit()
})
