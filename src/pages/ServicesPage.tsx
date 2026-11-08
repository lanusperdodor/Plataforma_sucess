import { Wrench } from 'lucide-react'
import { BusinessListing } from './BusinessListing.tsx'

export function ServicesPage() {
  return <BusinessListing type="servico" icon={Wrench} title="Serviços" subtitle="Profissionais e prestadores perto de você." />
}