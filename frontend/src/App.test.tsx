import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const P = (id: number, name: string, category = 'Phone') => ({ id, name, category, price: 1000 * id, tagline: 'Tag ' + name, description: 'About ' + name, stock: id === 2 ? 3 : 20, colors: ['Silver', 'Blue'], hue: 210 })
const PRODUCTS = [P(1, 'Lumen One'), P(2, 'Lumen Pad', 'Tablet')]
let calls: { url: string; init?: RequestInit }[] = []

function mock(orderOk = true) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const path = url.replace('http://localhost:8000', '')
    const json = (b: unknown, ok = true) => ({ ok, json: async () => b })
    if (path.startsWith('/auth/login')) return init?.body && JSON.parse(init.body as string).password === 'demo123' ? json({ token: 't', user: { email: 'demo@lumen.dev' } }) : json({ error: { message: 'Wrong email or password' } }, false)
    if (path === '/orders' && init?.method === 'POST') return orderOk ? json({ id: 12 }) : json({ error: { message: 'Not enough stock for Lumen One' } }, false)
    if (path === '/orders') return json({ items: [{ id: 12, status: 'confirmed', total: 3000, items: [{ qty: 3, name: 'Lumen One', color: 'Silver' }] }] })
    if (path.startsWith('/products/')) return json(PRODUCTS.find((p) => p.id === Number(path.split('/')[2])))
    return json({ items: PRODUCTS, total: 2 })
  }))
}
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); location.hash = '#/' })
afterEach(() => vi.unstubAllGlobals())
const signedIn = () => sessionStorage.setItem('lumen-auth', JSON.stringify({ token: 't', email: 'demo@lumen.dev' }))
const bag = () => localStorage.setItem('lumen-bag', JSON.stringify([{ id: 1, color: 'Silver', qty: 3 }]))

describe('Lumen store', () => {
  it('shows products from the API and searches, filters and sorts through the API', async () => {
    mock(); render(<App />)
    expect(await screen.findByText('Lumen One')).toBeInTheDocument()
    expect(screen.getByText('Only 3 left')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/search products/i), 'pad')
    await userEvent.click(screen.getByRole('button', { name: 'Tablet' }))
    await userEvent.selectOptions(screen.getByLabelText(/sort products/i), 'price_desc')
    expect(calls[calls.length - 1].url).toMatch(/q=pad&category=Tablet&sort=price_desc/)
  })
  it('adds a product to the bag and updates the bag count', async () => {
    mock(); location.hash = '#/p/1'; render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Blue' }))
    await userEvent.click(screen.getByRole('button', { name: /add to bag/i }))
    expect(screen.getByRole('link', { name: /bag \(1\)/i })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('lumen-bag')!)[0]).toMatchObject({ id: 1, color: 'Blue', qty: 1 })
  })
  it('changes quantities in the bag and shows the total', async () => {
    mock(); bag(); location.hash = '#/bag'; render(<App />)
    expect((await screen.findAllByText(/₹3,000/)).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /decrease lumen one/i }))
    expect((await screen.findAllByText(/₹2,000/)).length).toBeGreaterThan(0)
  })
  it('asks guests to sign in before checkout and handles a wrong password', async () => {
    mock(); bag(); location.hash = '#/checkout'; render(<App />)
    await userEvent.click((await screen.findAllByRole('link', { name: /sign in/i }))[0])
    await userEvent.clear(await screen.findByLabelText(/password/i))
    await userEvent.type(screen.getByLabelText(/password/i), 'nope123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong email or password/i)
  })
  it('validates the address on the client and sends no order', async () => {
    mock(); signedIn(); bag(); location.hash = '#/checkout'; render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /place order/i }))
    expect(await screen.findByText('Enter a 6 digit pincode')).toBeInTheDocument()
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })
  it('places an order with an idempotency key and clears the bag', async () => {
    mock(); signedIn(); bag(); location.hash = '#/checkout'; render(<App />)
    for (const [label, v] of [['Full name', 'Asha Rao'], ['Address', '12 MG Road'], ['City', 'Hyderabad'], ['Pincode', '500001']]) await userEvent.type(await screen.findByLabelText(label), v)
    await userEvent.click(screen.getByRole('button', { name: /place order/i }))
    expect(await screen.findByText(/order #12 is confirmed/i)).toBeInTheDocument()
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect((post.init!.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('lumen-bag')!)).toEqual([])
  })
  it('shows a server error when the order fails, and lists past orders', async () => {
    mock(false); signedIn(); bag(); location.hash = '#/checkout'; render(<App />)
    for (const [label, v] of [['Full name', 'Asha Rao'], ['Address', '12 MG Road'], ['City', 'Hyderabad'], ['Pincode', '500001']]) await userEvent.type(await screen.findByLabelText(label), v)
    await userEvent.click(screen.getByRole('button', { name: /place order/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not enough stock/i)
    location.hash = '#/orders'
    expect(await screen.findByText(/order #12/i)).toBeInTheDocument()
  })
})
