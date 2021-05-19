// ++ temp for count rollback times
const fs = require('fs');
const path = require('path');
const { eventBus } = require('./Events');
const Fcm = require('./Fcm');

class CrawlerManagerBase {
  constructor(blockchainId, database, logger) {
    this.bcid = blockchainId;
    this.database = database;
    this.logger = logger;

    this.accountModel = this.database.Account;
    this.accountCurrencyModel = this.database.AccountCurrency;
    this.accountAddressModel = this.database.AccountAddress;
    this.blockchainModel = this.database.Blockchain;
    this.blockScannedModel = this.database.BlockScanned;
    this.currencyModel = this.database.Currency;
    this.sequelize = this.database.sequelize;
    this.Sequelize = this.database.Sequelize;
    this.unparsedTxModel = this.database.UnparsedTransaction;
    this.pendingTransactionModel = this.database.PendingTransaction;
    this.transactionModel = this.database.Transaction;
    this.feeSyncInterval = 3600000;
    this.pendingTxSyncInterval = 15000;

    this.eventSender = eventBus;
  }

  async init() {
    this.fcm = Fcm.getInstance({ logger: this.logger });
    this.isSyncing = false;
    this.isUpdatePending = false;
    this.blockInfo = await this.getBlockInfo();
    this.currencyInfo = await this.getCurrencyInfo();
    if (this.blockInfo.start_block > this.blockInfo.block) {
      await this.updateBlockHeight(this.blockInfo.start_block);
    }
    setInterval(() => {
      this.syncAvgFee();
    }, this.feeSyncInterval);
    this.syncAvgFee();

    // ++ make crawler something wrong
    // ++ temp not sync pending transaction on btc
    setInterval(async () => {
      if (!this.isUpdatePending) {
        this.isUpdatePending = true;
        try {
          await this.updatePendingTransaction();
          this.isUpdatePending = false;
        } catch (error) {
          this.isUpdatePending = false;
        }
      }
    }, this.pendingTxSyncInterval);

    // ++ temp for count rollback times
    this.rollbackCountDir = path.normalize(`${__dirname}/../../../private/rollbackCount`);
    if (!fs.existsSync(this.rollbackCountDir)) {
      fs.mkdirSync(this.rollbackCountDir);
    }
    return this;
  }

  async assignParser() {
    // need override
    return Promise.resolve();
  }

  async avgFeeFromPeer() {
    // need override
    return Promise.resolve();
  }

  async getBlockInfo() {
    this.logger.debug(`[${this.constructor.name}] getBlockInfo`);
    try {
      const result = await this.blockchainModel.findOne({
        where: { blockchain_id: this.bcid },
      });
      return result;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] getBlockInfo error ${error}`);
      return {};
    }
  }

  async getCurrencyInfo() {
    this.logger.debug(`[${this.constructor.name}] getCurrencyInfo`);
    try {
      const result = await this.currencyModel.findOne({
        where: { blockchain_id: this.bcid, type: 1 },
        attributes: ['currency_id', 'decimals', 'symbol', 'type', 'contract'],
      });
      return result;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] currencyModel error ${error}`);
      return {};
    }
  }

  async blockNumberFromDB() {
    this.logger.debug(`[${this.constructor.name}] blockNumberFromDB`);
    try {
      const result = await this.blockchainModel.findOne({
        where: { blockchain_id: this.bcid },
      });
      return result.block;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] blockNumberFromDB error ${error}`);
      return Promise.reject(error);
    }
  }

  async blockHashFromDB(block) {
    this.logger.debug(`[${this.constructor.name}] blockHashFromDB(${block})`);
    const result = await this.blockScannedModel.findOne({
      where: { blockchain_id: this.bcid, block },
    });
    return result.block_hash;
  }

  async blockNumberFromPeer() {
    // need override
    return Promise.resolve();
  }

  // eslint-disable-next-line no-unused-vars
  async blockDataFromPeer(blockHash) {
    // need override
    return Promise.resolve();
  }

  // eslint-disable-next-line no-unused-vars
  async blockHashFromPeer(block) {
    // need override
    return Promise.resolve();
  }

  async checkBlockNumberLess() {
    this.logger.debug(`[${this.constructor.name}] checkBlockNumberLess`);
    this.dbBlock = await this.blockNumberFromDB();
    this.peerBlock = await this.blockNumberFromPeer();
    let intPeerBlock = this.peerBlock;
    if (typeof this.peerBlock === 'string') {
      intPeerBlock = parseInt(this.peerBlock, 16);
    }
    if (typeof this.dbBlock !== 'number' || typeof intPeerBlock !== 'number') {
      return false;
    }
    return this.dbBlock < intPeerBlock;
  }

  async checkBlockHash(block) {
    try {
      this.logger.debug(`[${this.constructor.name}] checkBlockHash(${block})`);
      const dbBlockHash = await this.blockHashFromDB(block);
      const peerBlockHash = await this.blockHashFromPeer(block);
      if (typeof dbBlockHash !== 'string' || typeof peerBlockHash !== 'string') {
        return false;
      }

      return dbBlockHash === peerBlockHash;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] checkBlockHash(${block}) error ${error}`);
      return false;
    }
  }

  async getBlockScanned(block) {
    try {
      this.logger.debug(`[${this.constructor.name}] getBlockScanned(${block})`);
      const result = await this.blockScannedModel.findOne({
        where: { blockchain_id: this.bcid, block },
      });
      return result;
    } catch (error) {
      this.logger.debug(`[${this.constructor.name}] getBlockScanned(${block}) error: ${error}`);
      throw error;
    }
  }

  async getTransactionsResultNull() {
    this.logger.log(`[${this.constructor.name}] getTransactionsResultNull`);
    try {
      const pendingTxs = await this.transactionModel.findAll({
        where: { currency_id: this.currencyInfo.currency_id, result: null },
      });
      return pendingTxs;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] getTransactionsResultNull error: ${error}`);
      return [];
    }
  }

  // eslint-disable-next-line no-unused-vars
  async insertBlock(blockData) {
    // need override
    return Promise.resolve();
  }

  async insertUnparsedTransaction() {
    // need override
    return Promise.resolve();
  }

  async oneCycle() {
    // need override
    return Promise.resolve();
  }

  async pendingTransactionFromPeer() {
    // need override
    return Promise.resolve();
  }

  async removeBlockScanned(blockScanned_id) {
    this.logger.debug(`[${this.constructor.name}] removeBlockScanned()`);
    try {
      await this.blockScannedModel.destroy({
        where: { blockScanned_id },
      });
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] removeBlockScanned() error: ${error}`);
      return Promise.reject(error);
    }
  }

  async removeUnparsedTx(timestamp) {
    this.logger.debug(`[${this.constructor.name}] removeUnparsedTx`);
    try {
      await this.unparsedTxModel.destroy({
        where: { blockchain_id: this.bcid, timestamp },
      });
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] removeUnparsedTx error: ${error}`);
      return Promise.reject(error);
    }
  }

  async rollbackBlock(block) {
    if (this.blockInfo.start_block >= block) {
      this.logger.error(`[${this.constructor.name}] rollbackBlock to start block ${block}`);
      return block;
    }

    this.logger.debug(`[${this.constructor.name}] rollbackBlock(${block})`);
    // step
    // 1. get blockscaned data
    // 2. remove UnparsedTransaction by timestamp
    // 3. remove blockScanned data
    // 4. update db block
    // 5. checkBlockHash
    // 5-1. if fail recursivly rollback
    try {
      const blockScannedData = await this.getBlockScanned(block);
      if (!blockScannedData || !blockScannedData.timestamp) throw new Error('roll back failed, blockScanned not found');

      const prevBlockHeight = block - 1;

      await this.removeUnparsedTx(blockScannedData.timestamp);

      await this.removeBlockScanned(blockScannedData.blockScanned_id);

      await this.updateBlockHeight(prevBlockHeight);

      if (!await this.checkBlockHash(prevBlockHeight)) {
        return await this.rollbackBlock(prevBlockHeight).catch((error) => error);
      }
      return prevBlockHeight;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] rollbackBlock(${block}) error: ${error}`);
      throw error;
    }
  }

  startParser() {
    this.eventSender.emit('StartParser');
  }

  stopParser() {
    this.eventSender.emit('StopParser');
  }

  // eslint-disable-next-line no-unused-vars
  async syncBlock(block) {
    // need override
    return Promise.resolve();
  }

  async syncAvgFee() {
    // need override
    return Promise.resolve();
  }

  async updateBlockHeight(block) {
    this.logger.debug(`[${this.constructor.name}] updateBlockHeight(${block})`);
    const insertResult = await this.blockchainModel.update(
      { block },
      { where: { blockchain_id: this.bcid } },
    );
    return insertResult;
  }

  async updateFee(avgFee) {
    this.logger.debug(`[${this.constructor.name}] updateFee(${avgFee})`);
    const insertResult = await this.blockchainModel.update(
      { avg_fee: avgFee },
      { where: { blockchain_id: this.bcid } },
    );
    return insertResult;
  }

  async updatePendingTransaction() {
    // need override
    return Promise.resolve();
  }
}

module.exports = CrawlerManagerBase;
