import assert from "node:assert/strict";
import test from "node:test";

import { hasSubstantiveReleaseNoteText } from "../scripts/release-note-content.mjs";

const referenceOnlyNotes = [
  ["URL obfuscated with combining grapheme joiner", "h\u034Fttps://example.test/release"],
  ["URL obfuscated with variation selector", "h\uFE0Fttps://example.test/release"],
  ["URL obfuscated with Mongolian variation selector", "h\u180Bttps://example.test/release"],
  ["fullwidth URL", "ｈｔｔｐｓ：／／example.test/release"],
  ["HTTP URL", "https://example.test/release"],
  ["Gopher URL", "gopher://example.test/1/releases"],
  ["empty HTTPS scheme", "https:"],
  ["empty mailto scheme", "mailto:"],
  ["empty URN scheme", "urn:"],
  ["mailto URI", "mailto:release@example.test"],
  ["data URI", "data:text/plain,release"],
  ["URN", "urn:example:release"],
  ["network-path reference", "//example.test/release"],
  ["absolute-path reference", "/releases"],
  ["Windows absolute-path reference", "C:\\releases"],
  ["current-directory reference", "./releases"],
  ["parent-directory reference", "../releases"],
  ["bare current directory", "./"],
  ["bare parent directory", "../"],
  ["fragment reference", "#release"],
  ["bare fragment marker", "#"],
  ["query reference", "?release=2.1.1"],
  ["bare query marker", "?"],
  ["repository path", "owner/repository"],
  ["SCP-style Git reference", "git@example.test:owner/repo"],
  ["ASCII bare domain", "example.test/release"],
  ["www domain", "www.example.test/release"],
  ["ideographic-dot IDN", "例え。テスト/リリース"],
  ["fullwidth-dot IDN", "例え．テスト/リリース"],
  ["halfwidth-dot IDN", "例え｡テスト/リリース"],
  ["Devanagari IDN", "उदाहरण.भारत/रिलीज"],
  ["punycode domain and TLD", "xn--r8jz45g.xn--zckzah/release"],
  ["full IPv6", "2001:0db8:0000:0000:0000:ff00:0042:8329"],
  ["compressed IPv6", "2001:db8::ff00:42:8329"],
  ["loopback IPv6", "::1"],
  ["bracketed IPv6 with port", "[::1]:3000/release"],
  ["canonical IPv4", "127.0.0.1:3000/release"],
  ["short IPv4", "127.1"],
  ["hexadecimal IPv4", "0x7f000001"],
  ["single-integer IPv4", "2130706433"],
  ["localhost", "localhost:3000/release"],
  ["localhost.localdomain", "localhost.localdomain"],
  ["localhost domain prefix", "localhost.example.test"],
  ["IPv4 domain prefix", "127.0.0.1.example.test"],
  ["domain email", "release@example.test"],
  ["localhost email", "release@localhost"],
  ["IPv4 email", "release@127.0.0.1"],
  ["bracketed IPv4 email", "release@[127.0.0.1]"],
  ["bracketed IPv6 email", "release@[::1]"],
  ["RFC IPv6 email literal", "release@[IPv6:::1]"],
  ["full RFC IPv6 email literal", "release@[IPv6:2001:db8::1]"],
  ["IDN email", "release@例え.テスト"],
  ["ideographic-dot IDN email", "release@例え。テスト"],
  ["punycode email", "release@xn--r8jz45g.xn--zckzah"],
  ["localhost.localdomain email", "release@localhost.localdomain"],
  ["localhost prefix email", "release@localhost.example.test"],
  ["IPv4 prefix email", "release@127.0.0.1.example.test"],
  ["default-ignorable-only text", "\u034F\u180B\uFE0F"],
  ["punctuation-only text", "..."],
];

const substantiveNotes = [
  ["Node.js technology token", "Node.js"],
  ["React.js technology token", "React.js"],
  ["node:test technology token", "node:test"],
  ["npm scoped-package technology token", "npm:@scope/package"],
  ["Deno.land technology token", "Deno.land"],
  ["technology token with sentence punctuation", "Node.js."],
  ["prose with URL", "See release notes at https://example.test/release"],
  ["prose with IDN", "See release notes at 例え。テスト/リリース"],
  ["prose with email", "Report issues to release@example.test"],
  ["Node.js version prose", "Added Node.js 22 support"],
  ["Deno prose", "Improved Deno 2 compatibility"],
  ["Italian prose", "Migliorata la stabilità del rilascio"],
  ["Japanese prose", "リリースの安定性を改善"],
  ["Devanagari prose", "रिलीज़ की स्थिरता में सुधार"],
];

test("reference-only release notes fail closed across URI, host, address, email, and path forms", () => {
  for (const [name, value] of referenceOnlyNotes) {
    assert.equal(hasSubstantiveReleaseNoteText(value), false, `${name}: ${JSON.stringify(value)}`);
  }
});

test("technology names and genuine multilingual prose remain substantive", () => {
  for (const [name, value] of substantiveNotes) {
    assert.equal(hasSubstantiveReleaseNoteText(value), true, `${name}: ${JSON.stringify(value)}`);
  }
});
