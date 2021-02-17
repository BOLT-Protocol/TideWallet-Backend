const BtcCrawlerManagerBase = require('./BtcCrawlerManagerBase')

class BtcCrawlerManager extends BtcCrawlerManagerBase {
  constructor(config, database, logger) {
    super('80000000', database, logger);
    this.options = config.bitcoin;
    this.syncInterval = config.syncInterval.bitcoin ? config.syncInterval.bitcoin : 900000;
  }
}

module.exports = BtcCrawlerManager;