/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if, import/no-dynamic-require, global-require */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved, no-restricted-syntax */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { ethers } = require('hardhat');
const { expect } = require('chai');

const sepoliaBridgeAddress = '0xA34BBAf52eE84Cd95a6d5Ac2Eab9de142D4cdB53';

const networkIDSepolia = 0;
const networkIDzkEVM = 1;

async function main() {
    let zkEVMProvider;
    let zkEVMBridgeContractAddress;

    const networkName = process.env.HARDHAT_NETWORK;
    // Use mainnet bridge address
    if (networkName === 'sepolia') {
        zkEVMBridgeContractAddress = sepoliaBridgeAddress;
        zkEVMProvider = new ethers.providers.JsonRpcProvider('https://rpc.zkatana.gelato.digital');
    } else {
        throw new Error('Network not supported');
    }

    // Load deployer
    let deployer; let deployerZkEVM;
    if (process.env.PVTKEY) {
        deployer = new ethers.Wallet(process.env.PVTKEY, ethers.provider);
        deployerZkEVM = new ethers.Wallet(process.env.PVTKEY, zkEVMProvider);
        console.log('Using pvtKey deployer with address: ', deployer.address);
    } else if (process.env.MNEMONIC) {
        deployer = ethers.Wallet.fromMnemonic(process.env.MNEMONIC, 'm/44\'/60\'/0\'/0/0').connect(ethers.provider);
        deployerZkEVM = ethers.Wallet.fromMnemonic(process.env.MNEMONIC, 'm/44\'/60\'/0\'/0/0').connect(zkEVMProvider);
        console.log('Using MNEMONIC deployer with address: ', deployer.address);
    } else {
        [deployer] = (await ethers.getSigners());
    }

    // Token params
    const name = 'customTokenName';
    const symbol = 'CTN';
    const initialAccount = deployer.address;
    const initialBalance = ethers.utils.parseEther('1000000000');

    // deploy mainnet token
    const erc20MainnetTokenFactory = await ethers.getContractFactory('CustomERC20Mainnet', deployer);
    const erc20MainnetToken = await erc20MainnetTokenFactory.deploy(
        name,
        symbol,
        initialAccount,
        initialBalance,
    );
    await erc20MainnetToken.deployed();
    console.log('erc20MainnetToken deployed');
    /*
     * We need to predict the rest of address in order to make the deployments
     * in production this could be done either using create2 patterns or with an initialize function
     */
    // Predict zkEVM address
    const nonceZkevm = Number(await deployerZkEVM.getTransactionCount());

    const predictERC20BridgeZkEVM = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceZkevm });
    const predictErc20zkEVMToken = ethers.utils.getContractAddress({ from: deployer.address, nonce: nonceZkevm + 1 });

    // deploy erc20 bridge
    const ERC20BridgeFactory = await ethers.getContractFactory('ERC20BridgeNativeChain', deployer);
    const ERC20Bridge = await ERC20BridgeFactory.deploy(
        zkEVMBridgeContractAddress,
        predictERC20BridgeZkEVM,
        networkIDzkEVM,
        erc20MainnetToken.address,
    );
    await ERC20Bridge.deployed();
    console.log('ERC20Bridge deployed');

    // deploy zkEVM erc20 bridge
    const ERC20BridgezkEVMFactory = await ethers.getContractFactory('ERC20BridgeNonNativeChain', deployerZkEVM);
    const ERC20BridgezkEVM = await ERC20BridgezkEVMFactory.deploy(
        zkEVMBridgeContractAddress,
        ERC20Bridge.address,
        networkIDSepolia,
        predictErc20zkEVMToken,
    );
    await ERC20BridgezkEVM.deployed();
    console.log('ERC20BridgezkEVM deployed');

    // deploy zkEVM token
    const erc20zkEVMTokenFactory = await ethers.getContractFactory('CustomERC20Wrapped', deployerZkEVM);
    const erc20zkEVMToken = await erc20zkEVMTokenFactory.deploy(
        name,
        symbol,
        initialAccount,
        initialBalance,
        predictERC20BridgeZkEVM,
    );
    await erc20zkEVMToken.deployed();
    console.log('erc20zkEVMToken deployed');

    expect(predictERC20BridgeZkEVM).to.be.equal(ERC20BridgezkEVM.address);
    expect(predictErc20zkEVMToken).to.be.equal(erc20zkEVMToken.address);

    const outputJson = {
        ERC20Bridge: ERC20Bridge.address,
        ERC20BridgezkEVM: ERC20BridgezkEVM.address,
        erc20MainnetToken: erc20MainnetToken.address,
        erc20zkEVMToken: erc20zkEVMToken.address,
        deployerAddress: deployer.address,
        tokenName: name,
        tokenSymbol: symbol,
        tokenInitialBalance: initialBalance.toString(),
    };
    const pathOutputJson = path.join(__dirname, './ERC20Bridge_output.json');

    fs.writeFileSync(pathOutputJson, JSON.stringify(outputJson, null, 1));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
