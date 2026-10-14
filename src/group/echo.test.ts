import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { novelWordCount, studentWords, withoutEcho } from "../../web/src/lib/echo.js";

const rex = "Şam şehri çok güzel, değil mi Ahmet?";
const professor = "Emevilerin camileri çok büyüktür, Ahmet, haklısın.";

describe("withoutEcho", () => {
  it("drops the group's own line coming back through the microphone, whole or in pieces", () => {
    assert.equal(withoutEcho("şam şehri çok güzel", [rex]), "");
    // The browser ends a phrase at every pause, so a line often comes back a few words at a time.
    assert.equal(withoutEcho("şam şehri", [rex]), "");
    assert.equal(withoutEcho("çok güzel", [rex]), "");
    assert.equal(withoutEcho("güzel", [rex]), "");
    assert.equal(withoutEcho("emevilerin camileri", [professor]), "");
  });

  it("copes with what recognition gets wrong", () => {
    assert.equal(withoutEcho("emevilerin camile", [professor]), "");
    assert.equal(withoutEcho("emevilerin camilerin", [professor]), "");
    assert.equal(withoutEcho("emevi lerin camileri", [professor]), "");
    assert.equal(withoutEcho("şam şehri çok gözel değilmi ahmed", [rex]), "");
    assert.equal(withoutEcho("haklisin ahmet", [professor]), "");
    assert.equal(withoutEcho("EMEVİLERİN CAMİLERİ", [professor]), "");
  });

  it("does not leave a stray word of the echo behind as if the student said it", () => {
    assert.equal(withoutEcho("şam şehri çok güzel mi", [rex]), "");
    assert.equal(withoutEcho("şam şehri çok güzel hmm", [rex]), "");
  });

  it("keeps what the student says over the group, without the echo around it", () => {
    assert.equal(withoutEcho("şam şehri çok güzel ama yazın çok sıcak", [rex]), "ama yazın çok sıcak");
    assert.equal(withoutEcho("bence selçuklular daha önemliydi", [professor]), "bence selçuklular daha önemliydi");
    assert.equal(withoutEcho("evet", [rex]), "evet");
  });

  it("keeps the line's words in the middle of what the student says: answers often repeat the question", () => {
    const luna = "Teşekkür ederim ahmet, iyiyim. Sen nasılsın?";
    assert.equal(withoutEcho("Ben de iyiyim çok teşekkür ederim sağ olun", [luna]), "Ben de iyiyim çok teşekkür ederim sağ olun");
  });

  it("leaves the student's words alone when nothing was being said", () => {
    assert.equal(withoutEcho("Şam şehri çok güzel", []), "Şam şehri çok güzel");
  });
});

describe("studentWords", () => {
  const T = 1_000_000;

  it("drops a line's echo that the browser only finishes after the group has gone quiet", () => {
    // Rex finished at T; the phrase began to arrive while he spoke, and was finished well after.
    assert.equal(studentWords("şam şehri çok güzel", T - 1500, T, [{ text: rex, end: T }]).own, "");
    // A short phrase whose first words only arrive after he stopped is still within the lag.
    assert.equal(studentWords("çok güzel", T + 1500, T, [{ text: rex, end: T }]).own, "");
  });

  it("checks a phrase against lines from a while back while the group keeps talking", () => {
    const old = "Ahmet, lütfen kötü kelimeler yok, sadece güzel Türkçe konuş, çocuk.";
    const lines = [
      { text: old, end: T - 15_000 },
      { text: "Profesör Whiskers, Şam şehri dört bin yıllık bir yerdir.", end: T - 10_000 },
      { text: "Luna, haklısın, Şam şehri çok eski ve büyük bir yer!", end: T - 3000 },
      { text: "Şam şehri çok büyük ve güzel bir yer, değil mi ahmet?" },
    ];
    assert.equal(studentWords("Ahmet lütfen kötü kelimeler yok Sadece güzel Türkçe konuş çocuk profesördir", T, T, lines).own, "");
  });

  it("leaves a phrase alone when it began after the group had gone quiet", () => {
    assert.deepEqual(studentWords("şam şehri çok güzel", T + 5000, T, [{ text: rex, end: T }]), { own: "şam şehri çok güzel", novel: 4 });
  });

  it("lets the student's own words through while the group talks, and counts them for cutting in", () => {
    assert.deepEqual(studentWords("hayır ben selçukluları seviyorum", T, T, [{ text: professor }]), {
      own: "hayır ben selçukluları seviyorum",
      novel: 4,
    });
  });
});

describe("novelWordCount", () => {
  it("counts only the words that were not being said", () => {
    assert.equal(novelWordCount("emevilerin camile ri", [professor]), 1);
    assert.equal(novelWordCount("hayır ben selçukluları seviyorum", [professor]), 4);
  });
});
