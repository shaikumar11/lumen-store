import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { call } from './api'

type Product = { id: number; name: string; category: string; price: number; tagline: string; description: string; stock: number; colors: string[]; hue: number }
type Line = { id: number; color: string; qty: number }
type Auth = { token: string; email: string }
const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
const CATS = ['Phone', 'Laptop', 'Tablet', 'Watch', 'Audio', 'Display']
const safe = <T,>(f: () => T, d: T) => { try { return f() } catch { return d } }
const store = (k: string, v: unknown, local = true) => safe(() => (local ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)), undefined)

function Art({ cat, hue, label }: { cat: string; hue: number; label: string }) {
  const a = `hsl(${hue} 22% 38%)`, b = `hsl(${hue} 40% 84%)`
  const shapes: Record<string, ReactNode> = {
    Phone: <><rect x="72" y="14" width="56" height="124" rx="13" fill={a} /><rect x="77" y="22" width="46" height="108" rx="9" fill={b} /></>,
    Laptop: <><rect x="44" y="30" width="112" height="76" rx="7" fill={a} /><rect x="50" y="36" width="100" height="64" rx="3" fill={b} /><path d="M28 112h144l-10 10H38z" fill={a} /></>,
    Tablet: <><rect x="50" y="18" width="100" height="124" rx="11" fill={a} /><rect x="56" y="25" width="88" height="110" rx="6" fill={b} /></>,
    Watch: <><rect x="84" y="10" width="32" height="26" fill={b} /><rect x="84" y="124" width="32" height="26" fill={b} /><rect x="72" y="36" width="56" height="88" rx="18" fill={a} /><rect x="78" y="44" width="44" height="72" rx="12" fill={b} /></>,
    Audio: <><ellipse cx="72" cy="84" rx="20" ry="30" fill={a} /><ellipse cx="128" cy="84" rx="20" ry="30" fill={a} /><ellipse cx="72" cy="78" rx="10" ry="16" fill={b} /><ellipse cx="128" cy="78" rx="10" ry="16" fill={b} /></>,
    Display: <><rect x="34" y="20" width="132" height="86" rx="7" fill={a} /><rect x="40" y="26" width="120" height="74" rx="3" fill={b} /><rect x="94" y="106" width="12" height="26" fill={a} /><rect x="72" y="130" width="56" height="8" rx="4" fill={a} /></>,
  }
  return <svg viewBox="0 0 200 160" role="img" aria-label={label} className="art">{shapes[cat]}</svg>
}

const Stock = ({ n }: { n: number }) => n === 0 ? <span className="stock out">Sold out</span> : n <= 10 ? <span className="stock low">Only {n} left</span> : <span className="stock">In stock</span>

function Home() {
  const [q, setQ] = useState(''), [cat, setCat] = useState(''), [sort, setSort] = useState('name')
  const [items, setItems] = useState<Product[] | null>(null), [error, setError] = useState('')
  useEffect(() => {
    call(`/products?size=50&q=${encodeURIComponent(q)}&category=${cat}&sort=${sort}`, null).then((d) => { setItems(d.items); setError('') }).catch((e) => setError(e.message))
  }, [q, cat, sort])
  return (<>
    <section className="hero"><p className="eyebrow">Lumen</p><h1>Technology that gets out of the way.</h1>
      <p>Phones, laptops and more, designed to disappear into your day.</p><a className="btn" href="#grid">Shop now</a></section>
    <section id="grid" className="wrap"><h2>All products</h2>
      <div className="bar2"><div className="chips" role="group" aria-label="Categories">
        {['', ...CATS].map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>{c || 'All'}</button>)}</div>
        <label className="sr" htmlFor="q">Search products</label><input id="q" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr" htmlFor="so">Sort products</label><select id="so" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Name</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></div>
      {error && <p role="alert" className="err">{error}</p>}
      {!items && !error && <p className="mut">Loading products...</p>}
      {items && !items.length && <p className="mut">No products match your search.</p>}
      <div className="grid">{(items ?? []).map((p) => (
        <a key={p.id} className="card" href={`#/p/${p.id}`}><Art cat={p.category} hue={p.hue} label={`${p.name} illustration`} />
          <h3>{p.name}</h3><p className="mut">{p.tagline}</p><p><b>{inr(p.price)}</b> <Stock n={p.stock} /></p></a>))}</div></section></>)
}

function ProductPage({ id, add }: { id: string; add: (p: Product, c: string) => void }) {
  const [p, setP] = useState<Product | null>(null), [color, setColor] = useState(''), [error, setError] = useState('')
  useEffect(() => { call(`/products/${id}`, null).then((d) => { setP(d); setColor(d.colors[0]) }).catch((e) => setError(e.message)) }, [id])
  if (error) return <p role="alert" className="err wrap">{error}</p>
  if (!p) return <p className="mut wrap">Loading...</p>
  return (<section className="wrap pp"><Art cat={p.category} hue={p.hue} label={`${p.name} in ${color}`} />
    <div><a href="#/">Back to store</a><h1>{p.name}</h1><p className="lead">{p.tagline}</p><p>{p.description}</p><p className="price">{inr(p.price)}</p>
      <fieldset><legend>Color: {color}</legend>{p.colors.map((c) => <button key={c} className={`chip ${c === color ? 'on' : ''}`} aria-pressed={c === color} onClick={() => setColor(c)}>{c}</button>)}</fieldset>
      <p><Stock n={p.stock} /></p><button className="btn" disabled={p.stock === 0} onClick={() => add(p, color)}>Add to bag</button></div></section>)
}

function Bag({ bag, catalog, setBag }: { bag: Line[]; catalog: Product[]; setBag: (b: Line[]) => void }) {
  const rows = bag.map((l) => ({ ...l, p: catalog.find((c) => c.id === l.id) })).filter((r) => r.p) as (Line & { p: Product })[]
  const total = rows.reduce((s, r) => s + r.p.price * r.qty, 0)
  const set = (i: number, qty: number) => setBag(bag.flatMap((l, n) => (n !== i ? [l] : qty < 1 ? [] : [{ ...l, qty: Math.min(qty, 5) }])))
  if (!bag.length) return <section className="wrap"><h1>Your bag</h1><p className="mut">Your bag is empty. <a href="#/">Continue shopping</a></p></section>
  return (<section className="wrap"><h1>Your bag</h1>
    {rows.map((r, i) => <div className="line" key={`${r.id}-${r.color}`}><Art cat={r.p.category} hue={r.p.hue} label={r.p.name} /><div><b>{r.p.name}</b><div className="mut">{r.color}</div></div>
      <div><button className="sq" aria-label={`Decrease ${r.p.name}`} onClick={() => set(i, r.qty - 1)}>-</button> <span aria-live="polite">{r.qty}</span> <button className="sq" aria-label={`Increase ${r.p.name}`} onClick={() => set(i, r.qty + 1)}>+</button></div><b>{inr(r.p.price * r.qty)}</b></div>)}
    <p className="total">Total <b>{inr(total)}</b></p><a className="btn" href="#/checkout">Check out</a></section>)
}

function Checkout({ bag, auth, clear }: { bag: Line[]; auth: Auth | null; clear: () => void }) {
  const [f, setF] = useState({ name: '', address: '', city: '', pincode: '' }), [errs, setErrs] = useState<Record<string, string>>({}), [msg, setMsg] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const key = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
  if (done) return <section className="wrap"><h1>Thank you</h1><p role="status">Order #{done} is confirmed. This is a demo store, so nothing was charged.</p><a className="btn" href="#/orders">View orders</a></section>
  if (!auth) return <section className="wrap"><h1>Check out</h1><p>Please <a href="#/signin">sign in</a> to place your order.</p></section>
  if (!bag.length) return <section className="wrap"><h1>Check out</h1><p className="mut">Your bag is empty.</p></section>
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v: Record<string, string> = {}
    if (f.name.trim().length < 2) v.name = 'Enter your full name'
    if (f.address.trim().length < 5) v.address = 'Enter your street address'
    if (f.city.trim().length < 2) v.city = 'Enter your city'
    if (!/^\d{6}$/.test(f.pincode)) v.pincode = 'Enter a 6 digit pincode'
    setErrs(v); setMsg('')
    if (Object.keys(v).length) return
    try {
      const o = await call('/orders', auth.token, 'POST', { items: bag.map((l) => ({ product_id: l.id, qty: l.qty, color: l.color })), shipping: f }, { 'Idempotency-Key': key.current })
      clear(); setDone(o.id)
    } catch (x) { setMsg((x as Error).message) }
  }
  const field = (k: keyof typeof f, label: string) => (<div><label htmlFor={k}>{label}</label>
    <input id={k} value={f[k]} aria-invalid={!!errs[k]} aria-describedby={errs[k] ? `${k}-e` : undefined} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    {errs[k] && <span id={`${k}-e`} className="err">{errs[k]}</span>}</div>)
  return (<section className="wrap narrow"><h1>Check out</h1><form onSubmit={submit} noValidate>
    {field('name', 'Full name')}{field('address', 'Address')}{field('city', 'City')}{field('pincode', 'Pincode')}
    {msg && <p role="alert" className="err">{msg}</p>}<p className="mut">Demo checkout. No real payment is taken.</p><button className="btn">Place order</button></form></section>)
}

function Orders({ auth }: { auth: Auth | null }) {
  const [items, setItems] = useState<any[] | null>(null), [error, setError] = useState('')
  useEffect(() => { if (auth) call('/orders', auth.token).then((d) => setItems(d.items)).catch((e) => setError(e.message)) }, [auth])
  if (!auth) return <section className="wrap"><h1>Orders</h1><p>Please <a href="#/signin">sign in</a> to see your orders.</p></section>
  return (<section className="wrap narrow"><h1>Your orders</h1>{error && <p role="alert" className="err">{error}</p>}
    {items && !items.length && <p className="mut">No orders yet.</p>}
    {(items ?? []).map((o) => <div className="card" key={o.id}><b>Order #{o.id}</b> <span className="stock">{o.status}</span><p>{o.items.map((i: any) => `${i.qty} x ${i.name} (${i.color})`).join(', ')}</p><b>{inr(o.total)}</b></div>)}</section>)
}

function SignIn({ onOk }: { onOk: (a: Auth) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'), [email, setEmail] = useState('demo@lumen.dev'), [pw, setPw] = useState('demo123'), [err, setErr] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try { const d = await call(mode === 'login' ? '/auth/login' : '/auth/register', null, 'POST', { email, password: pw }); onOk({ token: d.token, email: d.user.email }) } catch (x) { setErr((x as Error).message) }
  }
  return (<section className="wrap narrow"><h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1><form onSubmit={submit}>
    <label htmlFor="em">Email</label><input id="em" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
    <label htmlFor="pw">Password</label><input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
    {err && <p role="alert" className="err">{err}</p>}<button className="btn">{mode === 'login' ? 'Sign in' : 'Create account'}</button></form>
    <p><button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</button></p>
    <p className="hint">Demo account: demo@lumen.dev / demo123</p></section>)
}

export default function App() {
  const [hash, setHash] = useState(location.hash || '#/')
  const [auth, setAuth] = useState<Auth | null>(() => safe(() => JSON.parse(sessionStorage.getItem('lumen-auth') ?? 'null'), null))
  const [bag, setBagState] = useState<Line[]>(() => safe(() => JSON.parse(localStorage.getItem('lumen-bag') ?? '[]'), []))
  const [catalog, setCatalog] = useState<Product[]>([]), [note, setNote] = useState('')
  useEffect(() => { const f = () => setHash(location.hash || '#/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  useEffect(() => { call('/products?size=50', null).then((d) => setCatalog(d.items)).catch(() => undefined) }, [])
  const setBag = (b: Line[]) => { setBagState(b); store('lumen-bag', b) }
  const add = (p: Product, color: string) => {
    const i = bag.findIndex((l) => l.id === p.id && l.color === color)
    setBag(i < 0 ? [...bag, { id: p.id, color, qty: 1 }] : bag.map((l, n) => (n === i ? { ...l, qty: Math.min(l.qty + 1, 5) } : l)))
    setNote(`${p.name} added to your bag`)
  }
  const signIn = (a: Auth) => { setAuth(a); store('lumen-auth', a, false); location.hash = '#/' }
  const signOut = () => { setAuth(null); safe(() => sessionStorage.removeItem('lumen-auth'), undefined) }
  const [, page, arg] = hash.split('/')
  const count = bag.reduce((s, l) => s + l.qty, 0)
  return (<>
    <a className="skip" href="#main">Skip to content</a>
    <header className="top"><a className="brand" href="#/">Lumen</a><nav aria-label="Main"><a href="#/">Store</a><a href="#/orders">Orders</a><a href="#/bag">Bag ({count})</a>
      {auth ? <button className="link" onClick={signOut}>Sign out</button> : <a href="#/signin">Sign in</a>}</nav></header>
    <main id="main">
      {page === 'p' ? <ProductPage id={arg} add={add} /> : page === 'bag' ? <Bag bag={bag} catalog={catalog} setBag={setBag} /> :
        page === 'checkout' ? <Checkout bag={bag} auth={auth} clear={() => setBag([])} /> : page === 'orders' ? <Orders auth={auth} /> :
        page === 'signin' ? <SignIn onOk={signIn} /> : <Home />}</main>
    <div className="toast" role="status" aria-live="polite">{note}</div>
    <footer>Lumen is a fictional brand and a demo store. No real payments are taken. Built with React, TypeScript and FastAPI.</footer></>)
}
