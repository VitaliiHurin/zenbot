module.exports = {
  _ns: 'zenbot',

  'exchanges.cex': require('./exchange'),
  'exchanges.list[]': '#exchanges.cex'
}
