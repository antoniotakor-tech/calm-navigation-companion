const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./placeinfo.js");

const place = { name: "Chiesa Nuova", lat: 43.0702, lon: 12.6150 };

test("matches the article with the same distinctive name nearby", () => {
  const pages = [
    { title: "Temple of Minerva, Assisi", lat: 43.0707, lon: 12.6152 },
    { title: "Chiesa Nuova, Assisi", lat: 43.0703, lon: 12.6149 },
  ];
  assert.equal(P.bestArticle(place, pages).title, "Chiesa Nuova, Assisi");
});

test("doesn't attach a random nearby article to a place it isn't", () => {
  const pages = [{ title: "Temple of Minerva, Assisi", lat: 43.0712, lon: 12.6160 }];
  assert.equal(P.bestArticle(place, pages), null);
});

test("an unnamed match right on the spot is accepted", () => {
  const pages = [{ title: "Oratorio X", lat: 43.07021, lon: 12.61501 }];
  assert.equal(P.bestArticle({ name: "Something else", lat: 43.0702, lon: 12.6150 }, pages).title, "Oratorio X");
});

test("name matching ignores accents and filler words", () => {
  assert.ok(P.nameScore("Église Saint-Merri", "Saint-Merri") >= 0.5);
  assert.equal(P.nameScore("Library", "Town hall"), 0);
  assert.deepEqual(P.typeText("library")[0], "Public library");
});

test("a café never borrows the photo of the famous building it sits next to", () => {
  const pages = [{ title: "Royal Palace of Amsterdam", lat: 52.37311, lon: 4.89221 }];
  assert.equal(P.bestArticle({ name: "Bar Centrale", lat: 52.3731, lon: 4.8922, type: "bar" }, pages), null);
  assert.equal(P.bestArticle({ name: "Garden", lat: 52.3731, lon: 4.8922, type: "garden" }, pages).title, "Royal Palace of Amsterdam");
});
