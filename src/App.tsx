import { AppRoutes } from './app/routes.tsx'
import { RouteMeta } from './seo/RouteMeta.tsx'

export function App() {
  return (
    <>
      <RouteMeta />
      <AppRoutes />
    </>
  )
}
