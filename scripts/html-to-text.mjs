#!/usr/bin/env node
// Menampilkan HTML yang dirender server sebagai teks yang enak dibaca di terminal.
// Dipakai untuk pratinjau cepat tanpa membuka browser.
let html = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (html += chunk));
process.stdin.on('end', () => {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(div|section|header|footer|nav|main|p|li|tr|h1|h2|h3|form|table|fieldset|label)>/gi, '\n')
    .replace(/<(h1|h2|h3)[^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(th|td)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0 && line !== '|')
    .join('\n');
  console.log(text);
});
