import {
    createAztecSdk,
    SdkFlavour,
    WalletProvider,
    EthersAdapter,
    EthAddress,
    TxSettlementTime
} from "@aztec/sdk";
import * as ethers from 'ethers';

const config = {
    explorer  : 'https://aztec-connect-testnet-explorer.aztec.network',
    provider  : 'https://aztec-connect-testnet-eth-host.aztec.network:8545',
    serverUrl : 'https://api.aztec.network/aztec-connect-testnet/falafel',
    privateKey: '<your key here>',
    alias     : 'johndoe123'
}

let aztecSdk;
let ethereumAddress;
let accountKey;
let spendingKey;
let user;

// TODO: Find a way to only call init once
async function init() {
    const provider       = new ethers.providers.JsonRpcProvider(config.provider);
    const walletProvider = new WalletProvider(new EthersAdapter(provider));

    walletProvider.addAccount(config.privateKey);
    ethereumAddress = walletProvider.accounts[0].address;

    console.log(`Ethereum address: ${ethereumAddress}`);

    console.log('Initializing Aztec SDK');

    try {
        aztecSdk = await createAztecSdk(
            walletProvider,
            {
                serverUrl      : config.serverUrl, // Testnet
                pollInterval   : 1000,
                memoryDb       : false,
                minConfirmation: 1, // ETH block confirmations
                flavour        : SdkFlavour.PLAIN
            }
        );

        await aztecSdk.run();
    }
    catch(e) {
        console.error(e);
    }

    console.log('Aztec SDK initialized');
    console.log('Generating keys');

    try {
        accountKey  = await aztecSdk.generateAccountKeyPair(ethereumAddress);
        spendingKey = await aztecSdk.generateSpendingKeyPair(ethereumAddress); 
    }
    catch (e) {
        console.error(e);
    }

    // Check to see if the user already exists in the database
    let users = null;
    let user  = null;

    console.log('Checking to see if user exists in local database');

    try {
        users = await aztecSdk.getUsers();
    }
    catch (e) {
        console.error(e);
    }

    const userExists = users &&
        users.length > 0 &&
        users.find((grumpkinAddress) => grumpkinAddress.toString() == accountKey.publicKey.toString());

    if (!userExists) {
        console.log(`User doesn't exist, adding`);

        try {
            user = await aztecSdk.addUser(accountKey.privateKey);
        }
        catch (e) {
            console.error(e);
        }
    }

    if (!user) {
        console.log(`User exists, retrieving`);

        try {
            user = await aztecSdk.getUser(accountKey.publicKey);
        }
        catch (e) {
            console.error(e);
        }
    }

    console.log('Checking if user is registered');

    const registered = await aztecSdk.isAccountRegistered(user.id, true);
    
    if (!registered) {
        console.error(`User with Ethereum address ${ethereumAddress} is not registered! Please run createAccount()`);
        return false;
    }

    console.log('User is registered')

    const { nextRollupId } = (await aztecSdk.getRemoteStatus()).blockchainStatus;

    console.log('Syncing local database');

    let percentage = 0;

    const interval = setInterval(async () => {
        const userRollupId = await aztecSdk.getUserSyncedToRollup(user.id);

        let updatedPercentage = userRollupId < 0 ? 0 : ((userRollupId / (nextRollupId - 1)) * 100).toFixed(0);
        if (updatedPercentage != percentage) {
            percentage = updatedPercentage;
            console.log(`Synchronizing (${percentage}%)`);
        }

    }, 1000);

    await aztecSdk.awaitUserSynchronised(user.id);

    clearInterval(interval);

    console.log('Application initilization complete');

    return true;
}

async function createAccount() {
    if (!await init()) return process.exit(1);

    console.log('Creating account');

    const depositAmount      = ethers.utils.parseEther('1');
    const registerFees       = (await aztecSdk.getRegisterFees(aztecSdk.getAssetIdByAddress(EthAddress.ZERO)));
    const registerController = await aztecSdk.createRegisterController(
        user.id,
        config.alias,
        accountKey.privateKey,
        spendingKey.publicKey,
        null,
        {
            assetId: aztecSdk.getAssetIdByAddress(EthAddress.ZERO),
            value  : depositAmount.toBigInt()
        },
        registerFees[TxSettlementTime.INSTANT],
        EthAddress.fromString(ethereumAddress)
    );

    if ((await registerController.getPendingFunds()) < depositAmount.toBigInt()) {
        console.log('Depositing funds to contract');

        await registerController.depositFundsToContract();
        await registerController.awaitDepositFundsToContract();

        console.log('Funds deposited');
    }

    console.log('Creating proof');
    
    await registerController.createProof();

    console.log('Signing proof');

    await registerController.sign();

    console.log('Sending proof to rollup');

    const txId = await registerController.send();
    
    console.log(`Proof sent: ${config.explorer}/tx/${txId}`);
    
    return process.exit(0);
}

// TODO: This is an example of a function the queue runner will need to handle
async function deposit() {
    if (!await init()) return process.exit(1);

    const depositAmount = ethers.utils.parseEther('0.01');

    console.log(`Depositing ${ethers.utils.formatEther(depositAmount)} ETH`);
    
    const depositFees       = await aztecSdk.getDepositFees(aztecSdk.getAssetIdByAddress(EthAddress.ZERO));
    const depositController = await aztecSdk.createDepositController(
        EthAddress.fromString(ethereumAddress),
        {
            assetId: aztecSdk.getAssetIdByAddress(EthAddress.ZERO),
            value:   depositAmount.toBigInt()
        },
        depositFees[TxSettlementTime.INSTANT],
        user.id,
        true
    );

    if ((await depositController.getPendingFunds()) < depositAmount.toBigInt()) {
        console.log('Depositing funds to contract');

        await depositController.depositFundsToContract();
        await depositController.awaitDepositFundsToContract();

        console.log('Funds deposited');
    }

    console.log('Creating proof');

    await depositController.createProof();

    console.log('Signing proof');

    await depositController.sign();

    console.log('Sending proof to rollup');

    const txId = await depositController.send();

    console.log(`Proof sent: ${config.explorer}/tx/${txId}`);

    return process.exit(0);
}

deposit();