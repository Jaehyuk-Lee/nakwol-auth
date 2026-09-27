import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRequestAccessPolicy,
  canManageOwnedApplication,
  nextAvailableClientId,
  resolveAppStatus,
  hasConnectAppScope,
} from '../../src/connect-admin-developers';

test('developers may request guest/member but not admin policy', () => {
  assert.equal(canRequestAccessPolicy(false, 'guest'), true);
  assert.equal(canRequestAccessPolicy(false, 'public'), true);
  assert.equal(canRequestAccessPolicy(false, 'member'), true);
  assert.equal(canRequestAccessPolicy(false, 'admin'), false);
  assert.equal(canRequestAccessPolicy(true, 'admin'), true);
});

test('developers manage only owned apps while operators bypass ownership', () => {
  assert.equal(canManageOwnedApplication({ isOperator: false, userId: 'u1', ownerUserIds: ['u1'] }), true);
  assert.equal(canManageOwnedApplication({ isOperator: false, userId: 'u2', ownerUserIds: ['u1'] }), false);
  assert.equal(canManageOwnedApplication({ isOperator: true, userId: 'u2', ownerUserIds: [] }), true);
});

test('client id collision uses deterministic numeric suffix', () => {
  assert.equal(nextAvailableClientId('battle-map', new Set(['battle-map', 'battle-map-2'])), 'battle-map-3');
});

test('omitted app status preserves the current status', () => {
  assert.equal(resolveAppStatus('disabled', undefined), 'disabled');
  assert.equal(resolveAppStatus('active', undefined), 'active');
  assert.equal(resolveAppStatus('disabled', 'active'), 'active');
});

test('CLI app APIs require connect:apps scope', () => {
  assert.equal(hasConnectAppScope(['connect:apps']), true);
  assert.equal(hasConnectAppScope([]), false);
  assert.equal(hasConnectAppScope(['other']), false);
});
