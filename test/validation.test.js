'use strict';
/* Тесты общих правил проверки полей (public/shared/validation.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/shared/validation.js');

test('имя', () => {
  assert.equal(V.validateName('  Анна   Мария '), '');
  assert.equal(V.normName('  Анна   Мария '), 'Анна Мария');
  assert.ok(V.validateName(''));
  assert.ok(V.validateName('я'.repeat(61)));
  assert.ok(V.validateName('a<b'));
  assert.ok(V.validateName('123'));
  assert.equal(V.validateName('O\'Neil'), '');
});

test('почта', () => {
  assert.equal(V.validateEmail(' Anna@Example.COM '), '');
  assert.equal(V.normEmail(' Anna@Example.COM '), 'anna@example.com');
  for (const bad of ['', 'anna', 'anna@', 'anna@example', 'an na@example.com', 'x'.repeat(65) + '@example.com']) assert.ok(V.validateEmail(bad), bad);
  assert.equal(V.validateEmail('first.last+tag@sub.example.co'), '');
});

test('пароль', () => {
  assert.equal(V.validatePassword('Kv4rtira-plan', 'anna@example.com'), '');
  assert.ok(V.validatePassword('1234567'));
  assert.ok(V.validatePassword('x'.repeat(129)));
  assert.ok(V.validatePassword('annaanna', 'annaanna@example.com'));
  assert.ok(V.validatePassword('Password1'));
  assert.ok(V.validatePassword('12345678'));
  assert.equal(V.passwordStrength('short'), 0);
  assert.equal(V.passwordStrength('abcdefgh1'), 1);
  assert.equal(V.passwordStrength('Kv4rtira-plan!'), 2);
});

test('регистрация целиком', () => {
  const ok = V.validateRegistration({ name: 'Анна', email: 'a@b.co', password: 'Kv4rtira-plan', acceptTerms: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.marketing, false);
  const bad = V.validateRegistration({});
  assert.deepEqual(Object.keys(bad.fields).sort(), ['acceptTerms', 'email', 'name', 'password']);
});

test('опечатки в домене', () => {
  assert.equal(V.emailTypo('anna@gmial.com'), 'anna@gmail.com');
  assert.equal(V.emailTypo('anna@mail.ry'), 'anna@mail.ru');
  assert.equal(V.emailTypo('anna@gmail.com'), null);
});

test('next: только свой относительный путь', () => {
  assert.equal(V.safeNext('/editor?panel=catalog'), '/editor?panel=catalog');
  assert.equal(V.safeNext('/'), '/');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/javascript:alert(1)', '', null, '/login', '/register?next=/x', 'x'.repeat(201)]) {
    assert.equal(V.safeNext(bad), '/editor', String(bad));
  }
});
