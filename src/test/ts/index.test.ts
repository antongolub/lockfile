import { suite } from 'uvu'
import assert from 'node:assert'
import { parse, parseYarn1, parseYarn5, getSources } from '../../main/ts/index'

const test = suite('index')

test('properly exports its inners', async () => {
  const fns = [
    parse,
    parseYarn1,
    parseYarn5,
    getSources,
  ];

  fns.forEach((fn) => assert.ok(fn instanceof Function))
})

test.run()
