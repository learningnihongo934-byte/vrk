'use strict';
// Calculator: a standard calculator, with keyboard support. No eval.

(() => {
  const { h } = VRKOS;
  const { root } = VRKOS.app;

  let display = '0';
  let stored = null;
  let operator = null;
  let fresh = true; // the next digit starts a new number
  let expression = '';

  const out = h('output', {});
  const expr = h('small', {});
  const keys = h('div', { class: 'calc-keys' });
  root.append(h('div', { class: 'calc' }, h('div', { class: 'calc-display' }, expr, out), keys));

  const SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const apply = (a, op, b) => (op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b === 0 ? NaN : a / b);
  const format = (n) => {
    if (!Number.isFinite(n)) return 'Error';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8).replace(/\.?0+e/, 'e');
    return String(Number(n.toPrecision(14)));
  };

  function digit(d) {
    if (fresh || display === '0' || display === 'Error') {
      display = d === '.' ? '0.' : d;
      fresh = false;
    } else if (!(d === '.' && display.includes('.')) && display.replace(/[-.]/g, '').length < 15) display += d;
    render();
  }
  function op(next) {
    const value = Number(display);
    if (operator && !fresh) {
      stored = apply(stored, operator, value);
      display = format(stored);
    } else stored = value;
    operator = next;
    expression = `${format(stored)} ${SYMBOL[next]}`;
    fresh = true;
    render();
  }
  function equals() {
    if (!operator) return;
    const value = Number(display);
    expression = `${format(stored)} ${SYMBOL[operator]} ${format(value)} =`;
    display = format(apply(stored, operator, value));
    stored = null;
    operator = null;
    fresh = true;
    render();
  }
  function clear() {
    if (display !== '0' && !fresh) {
      display = '0';
      fresh = true;
    } else {
      stored = null;
      operator = null;
      expression = '';
      display = '0';
    }
    render();
  }
  const negate = () => {
    if (display !== '0' && display !== 'Error') display = display.startsWith('-') ? display.slice(1) : `-${display}`;
    render();
  };
  const percent = () => {
    display = format(Number(display) / 100);
    render();
  };

  const LAYOUT = [
    ['AC', 'fn', clear], ['±', 'fn', negate], ['%', 'fn', percent], ['÷', 'op', () => op('/')],
    ['7', '', () => digit('7')], ['8', '', () => digit('8')], ['9', '', () => digit('9')], ['×', 'op', () => op('*')],
    ['4', '', () => digit('4')], ['5', '', () => digit('5')], ['6', '', () => digit('6')], ['−', 'op', () => op('-')],
    ['1', '', () => digit('1')], ['2', '', () => digit('2')], ['3', '', () => digit('3')], ['+', 'op', () => op('+')],
    ['0', 'zero', () => digit('0')], ['.', '', () => digit('.')], ['=', 'op', equals],
  ];
  keys.replaceChildren(...LAYOUT.map(([label, cls, fn]) => h('button', { class: cls, 'data-key': label, onclick: fn }, label)));

  function render() {
    out.textContent = display.length > 12 ? format(Number(display)) : display;
    expr.textContent = expression;
    keys.querySelector('[data-key="AC"]').textContent = display !== '0' && !fresh ? 'C' : 'AC';
    keys.querySelectorAll('.op').forEach((b) => b.classList.toggle('on', fresh && operator && SYMBOL[operator] === b.textContent));
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey) return;
    if (/^[0-9.]$/.test(e.key)) digit(e.key);
    else if (['+', '-', '*', '/'].includes(e.key)) op(e.key);
    else if (e.key === 'Enter' || e.key === '=') equals();
    else if (e.key === 'Escape' || e.key === 'Delete') clear();
    else if (e.key === 'Backspace') {
      display = fresh || display.length <= 1 ? '0' : display.slice(0, -1);
      render();
    } else if (e.key === '%') percent();
  });
  // For tests and keyboard shortcuts elsewhere.
  window.calculator = { press: (keysText) => [...keysText].forEach((k) => dispatchEvent(new KeyboardEvent('keydown', { key: k }))), value: () => display };
  render();
})();
