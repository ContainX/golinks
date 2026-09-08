import Typography from '@mui/material/Typography'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { PlaceholderScreen } from '../pages/PlaceholderScreen.tsx'

/**
 * Boundary for a route that threw, and for the unlikely case of a path that
 * matches nothing at all. It reports the failure plainly instead of leaving a
 * blank page; how failures are presented is part of the UX design step.
 */
export function RouteErrorScreen() {
  const error = useRouteError()
  const summary = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <PlaceholderScreen title="Something went wrong" description="This page could not be shown.">
      <Typography>
        <code>{summary}</code>
      </Typography>
    </PlaceholderScreen>
  )
}
