module.exports = {
  BITCOIN: {
    blockchain_id: '80000000',
    name: 'Bitcoin',
    coin_type: 0,
    network_id: 0,
    publish: true,
    description: 'Bitcoin description',
    block: 0,
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
    start_block: 0,
    avg_fee: '0',
  },
  BITCOIN_TESTNET: {
    blockchain_id: '80000001',
    name: 'Bitcoin Testnet',
    coin_type: 1,
    network_id: 0,
    publish: false,
    description: 'Bitcoin Testnet description',
    block: 0,
    bip32: {
      public: 0x043587cf,
      private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
    start_block: 0,
    avg_fee: '0',
  },
  ETH: {
    blockchain_id: '80000060',
    name: 'Ethereum',
    coin_type: 60,
    network_id: 0,
    publish: true,
    description: 'Ethereum description',
    block: 0,
    bip32: {
      public: 0,
      private: 0,
    },
    pubKeyHash: 0,
    scriptHash: 0,
    wif: 0,
    start_block: 0,
    avg_fee: '0',
  },
  ROPSTEN: {
    blockchain_id: '80000603',
    name: 'Ropsten',
    coin_type: 603,
    network_id: 3,
    publish: false,
    description: 'Ropsten description',
    block: 0,
    bip32: {
      public: 0,
      private: 0,
    },
    pubKeyHash: 0,
    scriptHash: 0,
    wif: 0,
    start_block: 0,
    avg_fee: '0',
  },
  CAFECA: {
    blockchain_id: '80003324',
    name: 'Cafeca',
    coin_type: 3324,
    network_id: 0,
    publish: true,
    description: 'Cafeca description',
    block: 0,
    bip32: {
      public: 0,
      private: 0,
    },
    pubKeyHash: 0,
    scriptHash: 0,
    wif: 0,
    start_block: 0,
    avg_fee: '0',
  },
};
