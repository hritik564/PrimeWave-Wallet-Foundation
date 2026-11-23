import test from 'node:test';
import assert from 'node:assert/strict';
import { SensitiveNavigation } from '../sensitive-navigation';

test('Back, reveal dismissal and lock clear the associated UI references', () => {
  const navigation = new SensitiveNavigation();
  let pins = false;
  let reveal = false;
  const cleanup = { clearSecurityPins() { pins = false; }, clearReveal() { reveal = false; } };
  navigation.move('security', cleanup);
  pins = true;
  const pendingReveal = navigation.revision;
  navigation.move('wallet', cleanup);
  assert.equal(pins, false);
  navigation.move('security', cleanup);
  assert.notEqual(pendingReveal, navigation.revision);
  navigation.move('recovery', cleanup);
  reveal = true;
  navigation.move('security', cleanup);
  assert.equal(reveal, false);
  pins = reveal = true;
  navigation.move('locked', cleanup);
  assert.equal(pins || reveal, false);
});

test('backgrounding invalidates pending UI results before the screen changes', () => {
  const navigation = new SensitiveNavigation();
  const pending = navigation.revision;
  navigation.invalidate();
  assert.notEqual(pending, navigation.revision);
});
