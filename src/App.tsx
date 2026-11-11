import { AppRoutes } from './app/routes.tsx'
import { ConsentManager } from './components/consent/ConsentManager.tsx'
import { RouteMeta } from './seo/RouteMeta.tsx'

export function App() {
  return (
    <>
      <RouteMeta />
      <AppRoutes />
      <ConsentManager />
    </>
  )
}
