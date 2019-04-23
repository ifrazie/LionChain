const express = require('express');
const uuid = require('uuid/v1');
const bodyParser = require('body-parser');
const Blockchain = require('./blockchain');
const rp = require('request-promise');

const app = express();
const port = process.argv[2];

const nodeAddress = uuid().split('-').join('');
const bcoin = new Blockchain();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: false
}));

// get the whole blockchain
app.get('/blockchain', (req, res) => {
    res.send(bcoin);
});

// create a new transaction
app.post('/transaction', (req, res) => {
    const newTransaction = req.body;
    const blockIndex = bcoin.addTransactionToPendingTransactions(newTransaction);
    res.json({
        note: `Transaction will be added in block ${blockIndex}`
    });
});

// broadcast transactions to all nodes
app.post('/transaction/broadcast', (req, res) => {
    const newTransaction = bcoin.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient);
    bcoin.addTransactionToPendingTransactions(newTransaction);

    const requestPromises = [];
    bcoin.networkNodes.forEach(networkNodeUrl => {
        const requestOptions = {
            uri: networkNodeUrl + '/transaction',
            method: 'POST',
            body: newTransaction,
            json: true
        };
        requestPromises.push(rp(requestOptions));
    });

    Promise.all(requestPromises)
        .then(data => {
            res.json({
                note: 'Transactions broadcast successfully'
            });
        });
});

// mine a block
app.get('/mine', (req, res) => {
    //bcoin.createNewTransaction(12.5, "00", nodeAddress);
    const lastBlock = bcoin.getLastBlock();
    const previousBlockHash = lastBlock['hash'];
    const currentBlockData = {
        transactions: bcoin.pendingTransactions,
        index: lastBlock['index'] + 1
    };
    const nonce = bcoin.proofOfWork(previousBlockHash, currentBlockData);
    const blockHash = bcoin.hashBlock(previousBlockHash, currentBlockData, nonce);
    const newBlock = bcoin.createNewBlock(nonce, previousBlockHash, blockHash);
    const requestPromises = [];
    bcoin.networkNodes.forEach(networkNodeUrl => {
        const requestOptions = {
            uri: networkNodeUrl + '/receive-new-block',
            method: 'POST',
            body: {
                newBlock: newBlock
            },
            json: true
        };
        requestPromises.push(rp(requestOptions))
    });
    Promise.all(requestPromises)
        .then(data => {
            const requestOptions = {
                uri: bcoin.currentNodeUrl + '/transaction/broadcast',
                method: 'POST',
                body: {
                    amount: 12.5,
                    sender: "00",
                    recipient: nodeAddress
                },
                json: true
            };
            return rp(requestOptions);
        }).then(data => {
            res.json({
                note: 'New block mined & broadcast successfully',
                block: newBlock
            })
        })
});

// receive new mined blocks
app.post('/receive-new-block', (req, res) => {
    const newBlock = req.body.newBlock;
    const lastBlock = bcoin.getLastBlock();
    const correctHash = lastBlock.hash === newBlock.previousBlockHash;
    const correctIndex = lastBlock['index'] + 1 === newBlock['index'];
    if (correctHash && correctIndex) {
        bcoin.chain.push(newBlock);
        bcoin.pendingTransactions = [];
        res.json({
            note: 'New block received and accepted',
            newBlock: newBlock
        })
    } else {
        res.json({
            note: 'New block rejected',
            newBlock: newBlock
        })
    }
});

// register a node and broadcast to the network
app.post('/register-and-broadcast-node', (req, res) => {
    const newNodeUrl = req.body.newNodeUrl;

    if (bcoin.networkNodes.indexOf(newNodeUrl) === -1)
        bcoin.networkNodes.push(newNodeUrl);

    const regNodesPromises = [];
    bcoin.networkNodes.forEach(networkNodeUrl => {
        const requestOptions = {
            uri: networkNodeUrl + '/register-node',
            method: 'POST',
            body: {
                newNodeUrl: newNodeUrl
            },
            json: true
        };
        regNodesPromises.push(rp(requestOptions));
    });

    Promise.all(regNodesPromises)
        .then(data => {
            const bulkRegisterOptions = {
                uri: newNodeUrl + '/register-nodes-bulk',
                method: 'POST',
                body: {
                    allNetworkNodes: [...bcoin.networkNodes, bcoin.currentNodeUrl]
                },
                json: true
            };
            return rp(bulkRegisterOptions);
        }).then(data => {
            res.json({
                note: 'New node registered with the network successfully'
            })
        })
});

// register a single node with the network
app.post('/register-node', (req, res) => {
    const newNodeUrl = req.body.newNodeUrl;
    const nodeNotAlreadyPresent = bcoin.networkNodes.indexOf(newNodeUrl) === -1;
    const notCurrentNode = bcoin.currentNodeUrl !== newNodeUrl;
    if (nodeNotAlreadyPresent && notCurrentNode)
        bcoin.networkNodes.push(newNodeUrl);
    res.json({
        note: 'New node registered successfully'
    })
});

// register multiple nodes with the network
app.post('/register-nodes-bulk', (req, res) => {
    const allNetworkNodes = req.body.allNetworkNodes;

    allNetworkNodes.forEach(networkNodeUrl => {
        const nodeNotAlreadyPresent = bcoin.networkNodes.indexOf(networkNodeUrl) === -1;
        const notCurrentNode = bcoin.currentNodeUrl !== networkNodeUrl;
        if (nodeNotAlreadyPresent && notCurrentNode)
            bcoin.networkNodes.push(networkNodeUrl);
    });
    res.json({
        note: 'Bulk registration successful'
    })
});

app.listen(port, function () {
    console.log(`listening on port ${port}...`);
});
