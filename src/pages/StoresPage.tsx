import { ShoppingBag } from 'lucide-react'
import { BusinessListing } from './BusinessListing.tsx'

export function StoresPage() {
  return <BusinessListing type="loja" icon={ShoppingBag} title="Lojas" subtitle="Comércios da cidade: farmácia, moda, calçados e mais." />
}