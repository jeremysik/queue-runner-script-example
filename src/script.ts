import {
    createAztecSdk,
    EthersAdapter,
    SdkFlavour
} from "@aztec/sdk";
import * as ethers from 'ethers';

async function init() {
    const provider = new ethers.providers.JsonRpcProvider('https://aztec-connect-testnet-eth-host.aztec.network:8545');

    try {
        const aztecSdk = await createAztecSdk(
            new EthersAdapter(provider),
            {
                serverUrl      : 'https://api.aztec.network/aztec-connect-testnet/falafel', // Testnet
                pollInterval   : 1000,
                memoryDb       : true,
                minConfirmation: 1, // ETH block confirmations
                flavour        : SdkFlavour.PLAIN
            }
        );

        await aztecSdk.run();
    }
    catch(e) {
        console.error(e);
    }
}

async function run() {

}

init();