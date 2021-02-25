const EthParserBase = require('./EthParserBase');

class EthParser extends EthParserBase {
  constructor(config, database, logger) {
    super('8000003C', config, database, logger);

    this.options = config.ethereum.ropsten;
    this.syncInterval = config.syncInterval.ethereum ? config.syncInterval.ethereum : 15000;
  }
}

module.exports = EthParser;