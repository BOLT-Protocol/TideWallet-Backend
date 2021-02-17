const dvalue = require('dvalue');
const { v4: uuidv4 } = require('uuid');

const CrawlerManagerBase = require('./CrawlerManagerBase');
const Utils = require('./Utils');

class EthCrawlerManagerBase extends CrawlerManagerBase {
  constructor(blockchainId, database, logger) {
    super(blockchainId, database, logger);
    this.options = {};
    this.syncInterval = 15000;
  }

  async init() {
    await super.init();
    this.peerBlock = 0;
    try {
      this.oneCycle();
    } catch (error) {
      this.logger.log(`[${this.constructor.name}] ${error}`);
    }
    setInterval(async () => {
      try {
        this.oneCycle();
      } catch (error) {
        this.logger.log(`[${this.constructor.name}] ${error}`);
      }
    }, this.syncInterval);
  }

  async assignParser() {
    // TODO
    return Promise.resolve();
  }

  async blockNumberFromPeer() {
    this.logger.log(`[${this.constructor.name}] blockNumberFromPeer`);
    const type = 'getblockcount';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.log('\x1b[1m\x1b[90mbtc block number not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async blockDataFromPeer(blockHash) {
    this.logger.log(`[${this.constructor.name}] blockDataFromPeer(${blockHash})`);
    const type = 'getblock';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, blockHash });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.log('\x1b[1m\x1b[90mbtc block data not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async blockHashFromPeer(block) {
    this.logger.log(`[${this.constructor.name}] blockhashFromPeer(${block})`);
    const type = 'getblockhash';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      const blockData = data.result;
      return Promise.resolve(blockData.hash);
    }
    this.logger.log('\x1b[1m\x1b[90mbtc block hash not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async insertBlock(blockData) {
    this.logger.log(`[${this.constructor.name}] insertBlock(${blockData.hash})`);
    this.logger.log(`[${this.constructor.name}] this.bcid: ${this.bcid}`);
    this.logger.log(`[${this.constructor.name}] blockData.number: ${blockData.number}`);

    try {
      const insertResult = await this.blockScannedModel.findOrCreate({
        where: { Blockchain_id: this.bcid, block: parseInt(blockData.number, 16) },
        defaults: {
          BlockScanned_id: uuidv4(),
          Blockchain_id: this.bcid,
          block: parseInt(blockData.number, 16),
          block_hash: blockData.hash,
          timestamp: parseInt(blockData.timestamp, 16),
          result: JSON.stringify(blockData),
        },
      });
      return insertResult;
    } catch (error) {
      const e = new Error(`[${this.constructor.name}] insertBlock(${blockData.hash}) error: ${error}`);
      this.logger.log(e);
      return Promise.reject(e);
    }
  }

  async oneCycle() {
    try {
      if (this.isSyncing) return Promise.resolve('EthCrawlerManagerBase is sycning');
      this.isSyncing = true;
      // step
      // 1. blockNumberFromDB
      // 2. blockNumberFromPeer
      // 3. checkBlockNumber
      // 4. if equal wait to next cycle
      // 5. blockHashFromDB
      // 6. blockHashFromPeer
      // 7. checkBlockHash
      // 7-1 if not equal rollbackBlock
      // 8. syncNextBlock
      // 9. updateBalance
      // 10. wait to next cycle

      const dbBlock = await this.blockNumberFromDB();
      this.peerBlock = await this.blockNumberFromPeer();
      if (!await this.checkBlockNumberLess()) {
        this.logger.log(`[${this.constructor.name}] block height ${dbBlock} is top now.`);
        return Promise.resolve();
      }

      if (!await this.checkBlockHash(dbBlock)) {
        this.logger.log(`[${this.constructor.name}] block ${dbBlock} in db not the same as peer.`);
        // TODO
        // dbBlock = await this.rollbackBlock();
      }

      await this.syncBlock(dbBlock);

      await this.updateBalance();

      this.isSyncing = false;
      return Promise.resolve();
    } catch (error) {
      this.isSyncing = false;
      this.logger.log(error);
      return Promise.resolve();
    }
  }

  async syncBlock(block) {
    // step
    // 1. sync block +1
    // 2. save block data into db
    // 3. assign parser
    // 4. after parse done update blockchain table block column
    // 5. check block in db is equal to this.peerBlock
    // 6. if yes return
    // 7. if no, recursive

    try {
      let syncBlock = block;
      do {
        // 1. sync block +1
        this.logger.log(`[${this.constructor.name}] syncBlock(${syncBlock})`);
        syncBlock += 1;
        const syncBlockHash = await this.blockHashFromPeer(syncBlock);
        const syncResult = await this.blockDataFromPeer(syncBlockHash);
        if (!syncBlockHash || !syncResult) {
          // block hash or data not found
          // maybe network error or block doesn't exist
          // end this recursive
          return Promise.resolve(syncBlock - 1);
        }

        // 2. save block data into db
        // must success
        await this.insertBlock(syncResult);

        // 3. assign parser
        // must success

        // 4. after parse done update blockchain table block column
        await this.updateBlockHeight(syncBlock);
      } while (syncBlock < this.peerBlock);
      return Promise.resolve(syncBlock);
    } catch (error) {
      this.logger.log(`[${this.constructor.name}] syncBlock() error: ${error}`);
      return Promise.reject();
    }
  }

  async updateBalance() {
    // TODO
    return Promise.resolve();
  }

  async updateBlockHeight(block) {
    this.logger.log(`[${this.constructor.name}] updateBlockHeight(${block})`);
    const insertResult = await this.blockchainModel.update(
      { block },
      { where: { Blockchain_id: this.bcid } },
    );
    return insertResult;
  }

  static cmd({
    type, block, blockHash,
  }) {
    let result;
    switch (type) {
      case 'getblockcount':
        result = {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: dvalue.randomID(),
        };
        break;
      case 'getblockhash':
        result = {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: [`0x${block.toString(16)}`, false],
          id: dvalue.randomID(),
        };
        break;

      case 'getblock':
        result = {
          jsonrpc: '2.0',
          method: 'eth_getBlockByHash',
          params: [blockHash, true],
          id: dvalue.randomID(),
        };
        break;
      default:
        result = {};
    }
    return result;
  }
}

module.exports = EthCrawlerManagerBase;
