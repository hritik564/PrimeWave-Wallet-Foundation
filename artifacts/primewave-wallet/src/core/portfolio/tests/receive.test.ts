import assert from 'node:assert/strict';
import test from 'node:test';
import { supportedNetworks } from '@/src/core/networks';
import {
  createReceiveQrPayload,
  createReceiveShareMessage,
  RECEIVE_QR_ERROR_CORRECTION,
  RECEIVE_QR_QUIET_ZONE,
  RECEIVE_QR_SIZE,
  receiveNetworkStatus,
} from '@/src/components/receive.logic';

const ethereum = supportedNetworks.find((network) => network.id === 'ethereum');
const primewave = supportedNetworks.find((network) => network.id === 'primewave');

test('creates a deterministic QR payload from only the public address', () => {
  const address = '  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  ';
  assert.equal(createReceiveQrPayload(address), address.trim());
  assert.equal(createReceiveQrPayload(address), createReceiveQrPayload(address));
  assert.equal(createReceiveQrPayload(''), null);
  assert.equal(createReceiveQrPayload('   '), null);
});

test('keeps receive QR configuration scannable and explicit', () => {
  assert.equal(RECEIVE_QR_SIZE, 224);
  assert.equal(RECEIVE_QR_QUIET_ZONE, 12);
  assert.equal(RECEIVE_QR_ERROR_CORRECTION, 'M');
});

test('reports honest network state and public share content', () => {
  assert.ok(ethereum);
  assert.ok(primewave);
  assert.deepEqual(receiveNetworkStatus(ethereum), {
    configured: true,
    label: 'Configured',
  });
  assert.deepEqual(receiveNetworkStatus(primewave), {
    configured: false,
    label: 'Not configured',
  });
  const message = createReceiveShareMessage(
    'Ethereum',
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  );
  assert.equal(
    message,
    'WAVEX address — Ethereum:\n0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  );
  assert.equal(message.includes('private'), false);
  assert.equal(message.includes('mnemonic'), false);
  assert.equal(message.includes('PIN'), false);
});