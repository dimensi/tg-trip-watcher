import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRequiredTourFields, regexParseTour } from './regexParser';

const pattayaPost = `Паттайя, 8 ночей
Вылет из: #Владивосток #Дальний_Восток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6
Понравилось предложение? Перешлите его друзьям: https://turs.sale/tur/pattajya-8-nochej-96
Как путешествовать дешево читаем в t.me/piratesru`;

const hainanPost = `о.Хайнань, 6 ночей
Вылет из: #Дальний_Восток #Хабаровск
Даты: 18.03.26 - 24.03.26
Цена: 63800P
Бронировать: https://пртс.рф/1suR`;

const hurghadaPost = `Хургада, 6 ночей
Вылет из: #Поволжье #Самара
Даты: 12.03.26 - 18.03.26
Цена: 36200P
Бронировать: https://пртс.рф/jB31`;

const sharmPost = `Шарм эль Шейх, 7 ночей
Вылет из: #Пермь #Поволжье
Даты: 12.03.26 - 19.03.26
Цена: 35700P
Бронировать: https://пртс.рф/fPRU`;

const beijingPost = `Пекин, 7 ночей
Вылет из: #Москва #ПерелетОтель
Даты: 14.05.26 - 21.05.26
Цена: 51400P
Бронировать: https://пртс.рф/93sX`;

const alanyaPost = `Аланья, 6 ночей
Вылет из: #СПб
Даты: 01.06.26 - 07.07.26
Цена: 49900P
Бронировать: https://пртс.рф/5P2M
Понравилось предложение? Перешлите его друзьям: https://turs.sale/tur/alanya-6-nochej-268
Как путешествовать дешево читаем в t.me/piratesru`;

const nonTourPost = `Заброс в теплый Узбекистан: из СПб в Самарканд от 6700₽ в одну сторону
https://p.irat.es/tv3
#СПб #Авиабилеты
MAX: max.ru/piratesru
VK: vk.com/piratesru
Горящие туры: max.ru/turs_sale`;

test('regexParseTour parses Pattaya post and marks required fields as complete', () => {
  const parsed = regexParseTour(pattayaPost);
  assert.equal(parsed.destination, 'Паттайя');
  assert.equal(parsed.nights, 8);
  assert.deepEqual(parsed.departureCities, ['Владивосток', 'Дальний_Восток']);
  assert.equal(parsed.dateStart, '2026-03-15');
  assert.equal(parsed.dateEnd, '2026-03-23');
  assert.equal(parsed.price, 65700);
  assert.equal(parsed.bookingUrl, 'https://пртс.рф/c0g6');
  assert.equal(hasRequiredTourFields(parsed), true);
});

test('regexParseTour parses multiple real posts from dataset', () => {
  const dataset = [
    {
      text: hainanPost,
      destination: 'о.Хайнань',
      nights: 6,
      departureCities: ['Дальний_Восток', 'Хабаровск'],
      dateStart: '2026-03-18',
      dateEnd: '2026-03-24',
      price: 63800,
      bookingUrl: 'https://пртс.рф/1suR',
    },
    {
      text: hurghadaPost,
      destination: 'Хургада',
      nights: 6,
      departureCities: ['Поволжье', 'Самара'],
      dateStart: '2026-03-12',
      dateEnd: '2026-03-18',
      price: 36200,
      bookingUrl: 'https://пртс.рф/jB31',
    },
    {
      text: sharmPost,
      destination: 'Шарм эль Шейх',
      nights: 7,
      departureCities: ['Пермь', 'Поволжье'],
      dateStart: '2026-03-12',
      dateEnd: '2026-03-19',
      price: 35700,
      bookingUrl: 'https://пртс.рф/fPRU',
    },
    {
      text: beijingPost,
      destination: 'Пекин',
      nights: 7,
      departureCities: ['Москва', 'ПерелетОтель'],
      dateStart: '2026-05-14',
      dateEnd: '2026-05-21',
      price: 51400,
      bookingUrl: 'https://пртс.рф/93sX',
    },
    {
      text: alanyaPost,
      destination: 'Аланья',
      nights: 6,
      departureCities: ['СПб'],
      dateStart: '2026-06-01',
      dateEnd: '2026-07-07',
      price: 49900,
      bookingUrl: 'https://пртс.рф/5P2M',
    },
  ];

  for (const entry of dataset) {
    const parsed = regexParseTour(entry.text);
    assert.equal(parsed.destination, entry.destination);
    assert.equal(parsed.nights, entry.nights);
    assert.deepEqual(parsed.departureCities, entry.departureCities);
    assert.equal(parsed.dateStart, entry.dateStart);
    assert.equal(parsed.dateEnd, entry.dateEnd);
    assert.equal(parsed.price, entry.price);
    assert.equal(parsed.bookingUrl, entry.bookingUrl);
    assert.equal(hasRequiredTourFields(parsed), true);
  }
});

test('regexParseTour leaves required fields incomplete for non-tour post', () => {
  const parsed = regexParseTour(nonTourPost);
  assert.equal(parsed.nights, undefined);
  assert.equal(parsed.dateStart, undefined);
  assert.equal(parsed.dateEnd, undefined);
  assert.equal(parsed.price, undefined);
  assert.equal(parsed.bookingUrl, 'https://p.irat.es/tv3');
  assert.equal(hasRequiredTourFields(parsed), false);
});
