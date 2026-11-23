import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks';
import { createAppPortfolioRuntime } from '@/src/core/portfolio/runtime';
import { createEvmRpcProvider, type RpcTransport } from '@/src/core/blockchain/rpc';
import { encodeAbiParameters, encodeFunctionResult, parseAbiParameters } from 'viem';
import { getSendableAssets } from '../WalletSendScreen.logic';

const contract='0x0000000000000000000000000000000000000011';
const account={accountId:'account-1',accountAddress:'0x0000000000000000000000000000000000000001'};
function encodedString(value:string){return encodeFunctionResult({abi:[{type:'function',name:'f',stateMutability:'view',inputs:[],outputs:[{type:'string'}]}],functionName:'f',result:value});}
function encodedUint(value:bigint){return encodeAbiParameters(parseAbiParameters('uint256'),[value]);}

test('app-owned runtime registration drives the Assets/Home read model and native-only Send gate',async()=>{
 const registry=new NetworkRegistry(supportedNetworks);registry.selectActiveNetwork('ethereum');
 let balance=12n;let reads=0;
 const transport:RpcTransport={async request(request){
  const {method,params,id}=JSON.parse(request.body) as {method:string;params:any[];id:number};
  let result:string;
  if(method==='eth_chainId')result='0x1';
  else if(method==='eth_getBalance')result='0x9';
  else if(method==='eth_getCode')result='0x01';
  else if(method==='eth_call'){
   const data=String(params[0].data);
   if(data.startsWith('0x70a08231')){reads++;result=encodedUint(balance);}
   else if(data.startsWith('0x313ce567'))result=encodedUint(6n);
   else if(data.startsWith('0x06fdde03'))result=encodedString('Unknown Asset');
   else if(data.startsWith('0x95d89b41'))result=encodedString('SAME');
   else throw Error('unexpected method');
  } else throw Error('unexpected method');
  return {status:200,body:{jsonrpc:'2.0',id,result}};
 }};
 const runtime=createAppPortfolioRuntime(registry,async r=>createEvmRpcProvider(r,{transport}));
 await runtime.registerToken({networkId:'ethereum',contractAddress:contract});
 const home=await runtime.readModel.getPortfolio({...account,networkId:'ethereum'});
 const token=home.assets.find(a=>a.contractAddress===contract);
 assert.equal(token?.rawBalance,12n);
 assert.equal(token?.formattedBalance,'0.000012');
 balance=25n;
 const assets=await runtime.readModel.getPortfolio({...account,networkId:'ethereum'});
 assert.equal(assets.assets.find(a=>a.contractAddress===contract)?.rawBalance,25n);
 assert.ok(reads>=2);
 const sendable=getSendableAssets(assets.assets,{...supportedNetworks.find(n=>n.id==='ethereum')!});
 assert.deepEqual(sendable.map(a=>a.assetType),['native']);
 assert.equal(runtime.getRegisteredTokens().length,1);
});
