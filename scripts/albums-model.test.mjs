import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAlbumLines, mergeList, albumKey, pickUnplayed, listStats, removeList, initialAlbums, sortAlbums } from '../src/scripts/site/albums-model.ts'

test('parses the common pasted shapes', () => {
  const lines = parseAlbumLines('1. The Beatles – Revolver (1966)\n2) Joni Mitchell - Blue [1971]\nKendrick Lamar — To Pimp a Butterfly 2015\nNirvana: Nevermind\n')
  assert.deepEqual(lines, [
    { rank: 1, artist: 'The Beatles', title: 'Revolver', year: 1966 },
    { rank: 2, artist: 'Joni Mitchell', title: 'Blue', year: 1971 },
    { rank: null, artist: 'Kendrick Lamar', title: 'To Pimp a Butterfly', year: 2015 },
    { rank: null, artist: 'Nirvana', title: 'Nevermind', year: null },
  ])
  assert.deepEqual(parseAlbumLines('Blue – Joni Mitchell', { albumFirst: true })[0], { rank: null, artist: 'Joni Mitchell', title: 'Blue', year: null })
})

test('parses CSV with a header in any column order', () => {
  const lines = parseAlbumLines('Album,Artist,Year,Rank\n"Blue",Joni Mitchell,1971,3\n"Songs in the Key of Life","Stevie Wonder",1976,4\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[1], { rank: 4, artist: 'Stevie Wonder', title: 'Songs in the Key of Life', year: 1976 })
})

test('merges lists and dedupes on a normalised key', () => {
  assert.equal(albumKey('The Beatles', 'Revolver'), albumKey('Beatles', 'REVOLVER!'))
  const data = initialAlbums()
  const a = mergeList(data, 'RS500', parseAlbumLines('1. The Beatles – Revolver\n2. Joni Mitchell – Blue'), '2026-09-14')
  const b = mergeList(data, 'NME500', parseAlbumLines('1. Beatles – Revolver\n2. Nirvana – Nevermind'), '2026-09-14')
  assert.deepEqual(a, { added: 2, merged: 0 })
  assert.deepEqual(b, { added: 1, merged: 1 })
  assert.equal(data.albums.length, 3)
  assert.deepEqual(data.albums[0].lists, { RS500: 1, NME500: 1 })
  data.albums[1].listenedAt = '2026-09-14'
  assert.deepEqual(listStats(data), [{ name: 'RS500', total: 2, done: 1 }, { name: 'NME500', total: 2, done: 0 }])
  assert.equal(pickUnplayed(data, { list: 'RS500', random: 0.99 }).title, 'Revolver')
  assert.equal(pickUnplayed(data, { list: 'NME500', random: 0.99 }).title, 'Nevermind')
  removeList(data, 'NME500')
  assert.equal(data.albums.length, 2)
  assert.deepEqual(sortAlbums(data.albums, 'artist').map((x) => x.artist), ['Joni Mitchell', 'The Beatles'])
})
