const EthParserManagerBase = require('./EthParserManagerBase');

class TtnParserManager extends EthParserManagerBase {
  constructor(config, database, logger) {
    super('80001F51', config, database, logger);

    this.options = config.blockchain.titan;
  }

  async init() {
    await super.init();
  }
}

module.exports = TtnParserManager;
