const EthParserBase = require('./EthParserBase');

class TtnParser extends EthParserBase {
  constructor(config, database, logger) {
    super('80001F51', config, database, logger);

    this.options = config.blockchain.titan;
  }
}

module.exports = TtnParser;
