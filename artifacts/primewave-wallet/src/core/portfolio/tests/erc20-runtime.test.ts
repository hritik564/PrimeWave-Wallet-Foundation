import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeFunctionResult, parseAbiParameters } from 'viem';
import { TokenDiscoveryService, InMemoryTokenPreferenceRepository, type TokenPreferenceKeyValueStorage } from '@/src/core/assets';
import { EvmAccountStateService } from '@/src/core/blockchain/account-state';
import { createEvmRpcProvider, type RpcTransport } from '@/src/core/blockchain/rpc';
import { NetworkRegistry, supportedNetworks } from '@/src/core/networks';
import { AssetRegistry, ERC20TokenService } from '@/src/core/assets';
import { PortfolioAggregationService } from '../service';
import { createAppPortfolioRuntime, createWalletPortfolioRuntime } from '../runtime';

const accounts = [
  { accountId: 'account-a', accountAddress: '0x0000000000000000000000000000000000000001' },
  { accountId: 'account-b', accountAddress: '0x0000000000000000000000000000000000000002' },
] as const;
const contracts = [
  '0x0000000000000000000000000000000000000011',
  '0x0000000000000000000000000000000000000012',
] as const;

function str(value: string) { return encodeFunctionResult({abi:[{type:'function',name:'f',stateMutability:'view',inputs:[],outputs:[{type:'string'}]}],functionName:'f',result:value}); }
function uint(value: bigint) { return encodeAbiParameters(parseAbiParameters('uint256'),[value]); }

function fixture(options: { wrongChain?: boolean; failToken?: boolean; delayed?: boolean; delayedMetadata?: boolean; failInitialProvider?: boolean } = {}) {
  let delayMetadata = options.delayedMetadata ?? false;
  let tokenName = 'Test Token';
  const registry = new NetworkRegistry(supportedNetworks); registry.selectActiveNetwork('ethereum');
  const tokenBalances = new Map<string,bigint>();
  let started!:()=>void, release!:()=>void;
  const pending = new Promise<void>(r=>started=r), gate=new Promise<void>(r=>release=r);
  const transport: RpcTransport={async request(request) {
    const {method,params,id}=JSON.parse(request.body) as {method:string;params:any[];id:number};
    let result: string;
    if(method==='eth_chainId') result=options.wrongChain?'0x38':registry.getActiveNetwork()!.chainId!.toString(16).startsWith('0x')?String(registry.getActiveNetwork()!.chainId):'0x1';
    else if(method==='eth_getBalance') result='0x7';
    else if(method==='eth_getCode') result='0x01';
    else if(method==='eth_call') {
      const to=String(params[0].to).toLowerCase(), data=String(params[0].data);
      if(options.failToken && to===contracts[0] && data.startsWith('0x70a08231')) throw Error('RPC unavailable');
      if(data.startsWith('0x70a08231') && options.delayed && to===contracts[0]) { started(); await gate; }
      if(delayMetadata && to===contracts[0] && ['0x313ce567','0x06fdde03','0x95d89b41'].some(selector=>data.startsWith(selector))) { started(); await gate; }
      if(data.startsWith('0x70a08231')) {
        const addr='0x'+data.slice(-40); result=uint(tokenBalances.get(to+addr)??0n);
      } else if(data.startsWith('0x313ce567')) result=uint(18n);
      else if(data.startsWith('0x06fdde03')) result=str(tokenName);
      else if(data.startsWith('0x95d89b41')) result=str('TST');
      else throw Error('Unexpected token call');
    } else throw Error('Unexpected RPC method');
    return {status:200,body:{jsonrpc:'2.0',id,result}};
  }};
  let providerAttempts=0;
  const createProvider=async(r:NetworkRegistry)=>{
    providerAttempts++;
    if(options.failInitialProvider && providerAttempts===1) throw new Error('provider initialization failed');
    const selected=r.getActiveNetwork()!;
    const networkTransport:RpcTransport={async request(request) {
      const {method,params,id}=JSON.parse(request.body) as {method:string;params:any[];id:number};
      if(method==='eth_chainId') return {status:200,body:{jsonrpc:'2.0',id,result:options.wrongChain?'0x38':'0x'+selected.chainId!.toString(16)}};
      return transport.request(request);
    }};
    return createEvmRpcProvider(r,{transport:networkTransport});
  };
  const runtime=createAppPortfolioRuntime(registry,createProvider);
  return {registry,runtime,readModel:runtime.readModel,tokenBalances,pending,release,createProvider,transport,getProviderAttempts:()=>providerAttempts,setDelayedMetadata:(value:boolean)=>{delayMetadata=value;},setTokenName:(value:string)=>{tokenName=value;}};
}

class PreferenceStorage implements TokenPreferenceKeyValueStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  writes = 0;
  reads = 0;
  deferWrites = false;
  pending: { key: string; value: string; resolve: () => void }[] = [];
  async getItem(key: string) { this.reads++; if (this.failReads) throw new Error('read failure'); return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    this.writes++;
    if (this.deferWrites) await new Promise<void>((resolve) => this.pending.push({ key, value, resolve: () => { this.values.set(key, value); resolve(); } }));
    else this.values.set(key, value);
  }
  async removeItem(key: string) { this.values.delete(key); }
  completeNext() { const pending = this.pending.shift(); assert.ok(pending); pending.resolve(); }
}

test('native runtime gracefully reports no candidates and isolates network identity', async()=>{
  const f=fixture(); const a=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(a.assets.length,1); assert.equal(a.assets[0]?.assetType,'native');
  assert.equal(a.assets[0]?.rawBalance,7n);
  assert.equal(a.state,'ready');
  await assert.rejects(f.readModel.getPortfolio({...accounts[0],networkId:'bnb-smart-chain'}));
});

test('runtime registration persists across refresh, account and network switches, but not runtime instances', async()=>{
  const f=fixture();
  const candidate=await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  assert.equal(candidate.assetIdentity.networkId,'ethereum');
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,100n);
  f.tokenBalances.set(contracts[0]+accounts[1].accountAddress,25n);
  const first=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(first.assets.length,2);
  assert.equal(first.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,100n);
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,200n);
  const refreshed=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(refreshed.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,200n);
  const accountTwo=await f.readModel.getPortfolio({...accounts[1],networkId:'ethereum'});
  assert.equal(accountTwo.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,25n);
  f.registry.selectActiveNetwork('bnb-smart-chain');
  await assert.rejects(f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]}));
  await f.readModel.getPortfolio({...accounts[0],networkId:'bnb-smart-chain'});
  await f.runtime.registerToken({networkId:'bnb-smart-chain',contractAddress:contracts[0]});
  f.registry.selectActiveNetwork('ethereum');
  const back=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(back.assets.length,2);
  assert.equal(back.assets.find(asset=>asset.identity.networkId==='ethereum' && asset.identity.assetType==='fungible_token')?.rawBalance,200n);
  const isolated=fixture();
  const clean=await isolated.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(clean.assets.length,1);
});

test('runtime honors explicit token subsets, empty lists and omitted identities', async()=>{
  const f=fixture();
  await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[1]});
  const omitted=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(omitted.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,2);
  const subset=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum',tokenIdentities:[{assetType:'fungible_token',networkId:'ethereum',assetId:contracts[1]}]});
  assert.deepEqual(subset.assets.filter(asset=>asset.identity.assetType==='fungible_token').map(asset=>asset.identity.assetId),[contracts[1]]);
  const empty=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum',tokenIdentities:[]});
  assert.equal(empty.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,0);
  const unknown=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum',tokenIdentities:[{assetType:'fungible_token',networkId:'ethereum',assetId:'0x0000000000000000000000000000000000000099'}]});
  assert.equal(unknown.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,0);
});

test('runtime recovers after provider initialization failure and retains candidates', async()=>{
  const f=fixture({failInitialProvider:true});
  await assert.rejects(f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]}));
  assert.equal(f.getProviderAttempts(),1);
  const registered=await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  assert.equal(registered.assetIdentity.assetId,contracts[0]);
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,77n);
  const result=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(result.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,77n);
  assert.equal(f.getProviderAttempts(),2);
});

test('runtime provider failure preserves native balance and marks token unavailable', async()=>{
  const f=fixture({failToken:true});
  await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  const result=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(result.assets.find(asset=>asset.identity.assetType==='native')?.rawBalance,7n);
  assert.equal(result.assets.find(asset=>asset.identity.assetType==='fungible_token')?.availabilityState,'unavailable');
});

test('runtime initialization recovery retains registered token', async()=>{
  const f=fixture({failInitialProvider:true});
  await assert.rejects(f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]}));
  const candidate=await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  assert.equal(candidate.assetIdentity.contractAddress,contracts[0]);
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,88n);
  const recovered=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(recovered.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,88n);
  assert.equal(f.getProviderAttempts(),2);
});

test('runtime replacement reader retains catalog after network switch invalidates old provider', async()=>{
  const f=fixture();
  await f.runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  f.registry.selectActiveNetwork('bnb-smart-chain');
  await f.readModel.getPortfolio({...accounts[0],networkId:'bnb-smart-chain'});
  f.registry.selectActiveNetwork('ethereum');
  const result=await f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(result.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,1);
  assert.equal(result.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,0n);
});

test('token RPC errors stay unavailable and preserve native balance', async()=>{
  const f=fixture({failToken:true}); const assets=new AssetRegistry(f.registry); const provider=await f.createProvider(f.registry);
  const state=new EvmAccountStateService(f.registry,provider), read={accountState:state,provider};
  const tokens=new ERC20TokenService(assets,[read]); const discovery=new TokenDiscoveryService(tokens,[read]);
  await discovery.addUserToken({networkId:'ethereum',contractAddress:contracts[0]});
  const service=new PortfolioAggregationService(assets,new (await import('@/src/core/assets')).NativeAssetBalanceService(assets,[{service:state}]),tokens,[read],{tokenDiscoveryService:discovery});
  const result=await service.getPortfolio({...accounts[0],networkIds:['ethereum']});
  assert.equal(result.assets[0]?.balance.rawAmount,7n);
  assert.equal(result.assets[1]?.balance.rawAmount,null);
  assert.equal(result.assets[1]?.status,'balance_unavailable');
});

test('network switch during a token read rejects the old network result',async()=>{
  const f=fixture({delayed:true}); const assets=new AssetRegistry(f.registry); const provider=await f.createProvider(f.registry);
  const state=new EvmAccountStateService(f.registry,provider), read={accountState:state,provider};
  const tokens=new ERC20TokenService(assets,[read]); const discovery=new TokenDiscoveryService(tokens,[read]);
  await discovery.addUserToken({networkId:'ethereum',contractAddress:contracts[0]});
  const service=new PortfolioAggregationService(assets,new (await import('@/src/core/assets')).NativeAssetBalanceService(assets,[{service:state}]),tokens,[read],{tokenDiscoveryService:discovery});
  const pending=service.getPortfolio({...accounts[0],networkIds:['ethereum']}); await f.pending;
  f.registry.selectActiveNetwork('bnb-smart-chain'); f.release(); await assert.rejects(pending);
});

test('runtime returns unavailable when provider verifies the wrong chain', async()=>{
  const f=fixture({wrongChain:true});
  await assert.rejects(f.readModel.getPortfolio({...accounts[0],networkId:'ethereum'}));
});

test('portfolio query accepts only explicit token candidates and contract identity is chain scoped', async()=>{
  const f=fixture(); const assets=new AssetRegistry(f.registry); const provider=await f.createProvider(f.registry);
  const state=new EvmAccountStateService(f.registry,provider), read={accountState:state,provider};
  const tokens=new ERC20TokenService(assets,[read]); const discovery=new TokenDiscoveryService(tokens,[read]);
  const token=await discovery.addUserToken({networkId:'ethereum',contractAddress:contracts[0]});
  assert.equal(discovery.getCandidates().length,1);
  assert.equal(token.assetIdentity.networkId,'ethereum');
  const bsc=new NetworkRegistry(supportedNetworks); bsc.selectActiveNetwork('bnb-smart-chain');
  const bscTransport:RpcTransport={async request(request) {
    const {method,params,id}=JSON.parse(request.body) as {method:string;params:any[];id:number};
    let result:string;
    if(method==='eth_chainId') result='0x38';
    else if(method==='eth_getCode') result='0x01';
    else if(method==='eth_call') {
      const data=String(params[0].data);
      result=data.startsWith('0x313ce567')?uint(18n):data.startsWith('0x06fdde03')?str('Test Token'):data.startsWith('0x95d89b41')?str('TST'):uint(0n);
    } else result='0x1';
    return {status:200,body:{jsonrpc:'2.0',id,result}};
  }};
  const bscProvider=await createEvmRpcProvider(bsc,{transport:bscTransport});
  const bscAssets=new AssetRegistry(bsc), bscState=new EvmAccountStateService(bsc,bscProvider), bscRead={accountState:bscState,provider:bscProvider};
  const bscTokens=new ERC20TokenService(bscAssets,[bscRead]); const bscDiscovery=new TokenDiscoveryService(bscTokens,[bscRead]);
  const other=await bscDiscovery.addUserToken({networkId:'bnb-smart-chain',contractAddress:contracts[0]});
  assert.notEqual(token.assetIdentity.networkId,other.assetIdentity.networkId);
  assert.notEqual(token.assetIdentity,other.assetIdentity);
});

test('production runtime restores registered token after restart and reads a fresh account-specific balance', async()=>{
  const f=fixture(); const storage=new PreferenceStorage();
  const first=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-restart',preferenceStorage:storage});
  await first.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  for (const raw of storage.values.values()) assert.equal(raw.includes('rawBalance'),false);
  f.setTokenName('Revalidated Token');
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,41n);

  const restarted=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-restart',preferenceStorage:storage});
  const accountOne=await restarted.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(accountOne.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,41n);
  assert.equal(restarted.getRegisteredTokens().length,1);
  assert.equal(restarted.getRegisteredTokens()[0]?.token.name,'Revalidated Token');
  f.tokenBalances.set(contracts[0]+accounts[0].accountAddress,99n);
  const fresh=await restarted.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(fresh.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,99n);
  f.tokenBalances.set(contracts[0]+accounts[1].accountAddress,7n);
  const accountTwo=await restarted.readModel.getPortfolio({...accounts[1],networkId:'ethereum'});
  assert.equal(accountTwo.assets.find(asset=>asset.identity.assetType==='fungible_token')?.rawBalance,7n);
});

test('production runtime retains same-address token preferences separately by network and visibility',async()=>{
  const f=fixture(); const storage=new PreferenceStorage();
  const first=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-networks',preferenceStorage:storage});
  await first.registerToken({networkId:'ethereum',contractAddress:contracts[0],visibility:'hidden'});
  f.registry.selectActiveNetwork('bnb-smart-chain');
  await first.registerToken({networkId:'bnb-smart-chain',contractAddress:contracts[0]});
  const restarted=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-networks',preferenceStorage:storage});
  const bnb=await restarted.readModel.getPortfolio({...accounts[0],networkId:'bnb-smart-chain',includeHidden:true});
  assert.equal(bnb.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,1);
  assert.equal(restarted.getRegisteredTokens()[0]?.assetIdentity.networkId,'bnb-smart-chain');
  f.registry.selectActiveNetwork('ethereum');
  const ethereum=await restarted.readModel.getPortfolio({...accounts[0],networkId:'ethereum',includeHidden:true});
  assert.equal(ethereum.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,1);
  const restoredHidden=restarted.getRegisteredTokens().find(candidate=>candidate.assetIdentity.networkId==='ethereum');
  assert.equal(restoredHidden?.visibility,'hidden');
});

test('production runtime deduplicates registration, rejects invalid identities, and isolates wallets',async()=>{
  const f=fixture(); const storage=new PreferenceStorage();
  const first=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-isolated-a',preferenceStorage:storage});
  await first.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  await first.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  assert.equal(first.getRegisteredTokens().length,1);
  await assert.rejects(first.registerToken({networkId:'ethereum',contractAddress:'incomplete'}));
  const second=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-isolated-b',preferenceStorage:storage});
  const result=await second.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  assert.equal(result.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,0);
  assert.equal(second.getRegisteredTokens().length,0);
});

test('production runtime reports corrupt and unreadable preferences without overwriting them',async()=>{
  const f=fixture(); const storage=new PreferenceStorage();
  const first=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-storage',preferenceStorage:storage});
  await first.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  const original=new Map(storage.values); const writes=storage.writes;
  storage.failReads=true;
  const unavailable=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-storage',preferenceStorage:storage});
  await assert.rejects(unavailable.readModel.getPortfolio({...accounts[0],networkId:'ethereum'}), {code:'READ_MODEL_PREFERENCES_UNAVAILABLE'});
  assert.equal(unavailable.getPreferenceState(),'unavailable');
  assert.equal(storage.writes,writes);
  assert.deepEqual(storage.values,original);
  storage.failReads=false;
  const recovered=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-storage',preferenceStorage:storage});
  assert.equal((await recovered.readModel.getPortfolio({...accounts[0],networkId:'ethereum'})).assets.filter(asset=>asset.identity.assetType==='fungible_token').length,1);

  const key=[...storage.values.keys()][0]!;
  storage.values.set(key,'corrupt');
  const corrupted=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-storage',preferenceStorage:storage});
  await assert.rejects(corrupted.readModel.getPortfolio({...accounts[0],networkId:'ethereum'}), {code:'READ_MODEL_PREFERENCES_UNAVAILABLE'});
  assert.equal(corrupted.getRegisteredTokens().length,0);
});

test('network switch during persisted-token metadata validation rejects stale restoration',async()=>{
  const delayed=fixture();
  const delayedStorage=new PreferenceStorage();
  const seed=createAppPortfolioRuntime(delayed.registry,delayed.createProvider,{walletId:'wallet-delayed',preferenceStorage:delayedStorage});
  await seed.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  delayed.setDelayedMetadata(true);
  const reopened=createAppPortfolioRuntime(delayed.registry,delayed.createProvider,{walletId:'wallet-delayed',preferenceStorage:delayedStorage});
  const pending=reopened.readModel.getPortfolio({...accounts[0],networkId:'ethereum'});
  await delayed.pending;
  delayed.registry.selectActiveNetwork('bnb-smart-chain');
  delayed.release();
  await assert.rejects(pending);
  const otherNetwork=await reopened.readModel.getPortfolio({...accounts[0],networkId:'bnb-smart-chain'});
  assert.equal(otherNetwork.assets.filter(asset=>asset.identity.assetType==='fungible_token').length,0);
});

test('production runtime reset retires delayed registration writes before clearing wallet partition',async()=>{
  const f=fixture(); const storage=new PreferenceStorage();
  const runtime=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-runtime-reset',preferenceStorage:storage});
  await runtime.ready(); storage.deferWrites=true;
  const registration=runtime.registerToken({networkId:'ethereum',contractAddress:contracts[0]});
  while(storage.pending.length===0) await Promise.resolve();
  const reset=runtime.clear();
  storage.completeNext();
  await registration;
  await reset;
  assert.equal(storage.values.size,0);
  const afterReset=createAppPortfolioRuntime(f.registry,f.createProvider,{walletId:'wallet-runtime-reset',preferenceStorage:storage});
  assert.equal((await afterReset.readModel.getPortfolio({...accounts[0],networkId:'ethereum'})).assets.filter(asset=>asset.identity.assetType==='fungible_token').length,0);
});

test('Preview Test Mode never constructs or accesses the persistent wallet preference runtime',()=>{
  const storage=new PreferenceStorage(); storage.failReads=true;
  const runtime=createWalletPortfolioRuntime({previewMode:true,walletId:'preview-fixture',preferenceStorage:storage});
  assert.equal(runtime,null);
  assert.equal(storage.reads,0);
  assert.equal(storage.writes,0);
});
