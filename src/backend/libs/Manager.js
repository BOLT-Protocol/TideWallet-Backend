const ecrequest = require('ecrequest');
const { v4: uuidv4 } = require('uuid');
const { default: BigNumber } = require('bignumber.js');
const Bot = require('./Bot');

// crawler
const BtcCrawlerManager = require('./BtcCrawlerManager');
const BtcTestnetCrawlerManager = require('./BtcTestnetCrawlerManager');
const EthCrawlerManager = require('./EthCrawlerManager');
const EthRopstenCrawlerManager = require('./EthRopstenCrawlerManager');
const CfcCrawlerManager = require('./CfcCrawlerManager');
const TtnCrawlerManager = require('./TtnCrawlerManager');

// parser
const BtcParserManager = require('./BtcParserManager');
const BtcTestnetParserManager = require('./BtcTestnetParserManager');
const EthParserManager = require('./EthParserManager');
const EthRopstenParserManager = require('./EthRopstenParserManager');
const CfcParserManager = require('./CfcParserManager');
const TtnParserManager = require('./TtnParserManager');

class Manager extends Bot {
  constructor() {
    super();
    this.name = 'Manager';
    this._crawlerManagers = [];
    this.rateSyncInterval = 86400000;
    this.cryptoRateSyncInterval = 3600000;
  }

  init({
    config, database, logger, i18n,
  }) {
    return super.init({
      config, database, logger, i18n,
    }).then(() => {
      this._crawlerManagers = this.createManager();

      this.fiatCurrencyRateModel = this.database.db.FiatCurrencyRate;
      this.currencyModel = this.database.db.Currency;

      if (this.config.syncSwitch.cryptoRate) {
        setInterval(() => {
          this.syncCryptoRate();
        }, this.cryptoRateSyncInterval);
        this.syncCryptoRate();
      }

      if (this.config.syncSwitch.rate) {
        setInterval(() => {
          this.syncRate();
        }, this.rateSyncInterval);
        this.syncRate();
      }
      return this;
    });
  }

  start() {
    return super.start()
      .then(() => {
        this.initManager();
        return this;
      });
  }

  syncRate() {
    const opt = {
      protocol: 'https:',
      port: '',
      hostname: 'rate.bot.com.tw',
      path: '/xrt/fltxt/0/day',
    };

    ecrequest.get(opt).then(async (rs) => {
      const parseObject = rs.data.toString().split('\n').map((item) => item.split(/[ ]+/));

      for (const item of parseObject) {
        const findCurrency = await this.currencyModel.findOne({
          where: { symbol: item[0], type: 0 },
        });
        if (findCurrency) {
          const findRate = await this.fiatCurrencyRateModel.findOne({
            where: { currency_id: findCurrency.currency_id },
          });
          if (findRate) {
            // if found, update it
            await this.fiatCurrencyRateModel.update(
              { balance: new BigNumber(item[3]).toFixed() },
              { where: { fiatCurrencyRate_id: findRate.fiatCurrencyRate_id, currency_id: findCurrency.currency_id } },
            );
          } else {
            // if not found, create
            await this.fiatCurrencyRateModel.create({
              fiatCurrencyRate_id: uuidv4(),
              currency_id: findCurrency.currency_id,
              rate: new BigNumber(item[3]).toFixed(),
            });
          }
        }
      }
    });
  }

  syncCryptoRate() {
    const BTCObj = { asset_id: '5b1ea92e584bf50020130612', symbol: 'BTC' };
    const ETHObj = { asset_id: '5b755dacd5dd99000b3d92b2', symbol: 'ETH' };
    const USDID = '5b1ea92e584bf50020130615';

    for (const crypto of [BTCObj, ETHObj]) {
      const opt = {
        protocol: 'https:',
        port: '',
        hostname: 'api.cryptoapis.io',
        path: `/v1/exchange-rates/${crypto.asset_id}/${USDID}`,
        headers: {
          'X-API-Key': this.config.cryptoapis.key,
          'Content-Type': 'application/json',
        },
      };

      // eslint-disable-next-line no-loop-func
      ecrequest.get(opt)
        .then(async (rs) => {
          const { payload } = JSON.parse(rs.data.toString());
          await this.currencyModel.update(
            { exchange_rate: payload.amount },
            { where: { symbol: crypto.symbol } },
          );
        })
        .catch((e) => {
          this.logger.error('syncCryptoRate error:', e);
        });
    }
  }

  createManager() {
    this.logger.log('createManager');
    const result = [];
    const { syncSwitch } = this.config;
    const syncSwitchSet = Object.keys(syncSwitch);

    /**
     * 'bitcoin_mainnet',
     * 'bitcoin_testnet',
     * 'ethereum_mainnet',
     * 'ethereum_ropsten',
     * 'cafeca'
     * 'titan'
     */
    syncSwitchSet.forEach((blockchianName) => {
      if (!syncSwitch[blockchianName]) return;
      this.logger.log(blockchianName);
      switch (blockchianName) {
        case 'bitcoin_mainnet':
          result.push(new BtcCrawlerManager(this.config, this.database, this.logger));
          result.push(new BtcParserManager(this.config, this.database, this.logger));
          break;
        case 'bitcoin_testnet':
          result.push(new BtcTestnetCrawlerManager(this.config, this.database, this.logger));
          result.push(new BtcTestnetParserManager(this.config, this.database, this.logger));
          break;
        case 'ethereum_mainnet':
          result.push(new EthCrawlerManager(this.config, this.database, this.logger));
          result.push(new EthParserManager(this.config, this.database, this.logger));
          break;
        case 'ethereum_ropsten':
          result.push(new EthRopstenCrawlerManager(this.config, this.database, this.logger));
          result.push(new EthRopstenParserManager(this.config, this.database, this.logger));
          break;
        case 'cafeca':
          result.push(new CfcCrawlerManager(this.config, this.database, this.logger));
          result.push(new CfcParserManager(this.config, this.database, this.logger));
          break;
        case 'titan':
          result.push(new TtnCrawlerManager(this.config, this.database, this.logger));
          result.push(new TtnParserManager(this.config, this.database, this.logger));
          break;
        default:
      }
    });
    return result;
  }

  initManager() {
    this._crawlerManagers.forEach((manager) => {
      manager.init();
    });
  }
}

module.exports = Manager;
