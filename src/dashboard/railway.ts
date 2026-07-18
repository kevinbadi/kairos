/**
 * Railway deploy-status check for the dashboard. Answers exactly one
 * question — "is the worker service deployed and healthy on Railway?" —
 * via Railway's public GraphQL API. Token-optional: no RAILWAY_API_TOKEN,
 * no check, no error. Run outcomes come from the worker itself; this is
 * only the infrastructure layer underneath it.
 */

export interface RailwayDeployStatus {
  /** Railway deployment status, e.g. SUCCESS, FAILED, CRASHED, DEPLOYING. */
  status: string;
  createdAt: string | null;
  url: string | null;
}

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';

const DEPLOYMENTS_QUERY = `query deployments($serviceId: String!) {
  deployments(first: 1, input: { serviceId: $serviceId }) {
    edges { node { status createdAt staticUrl } }
  }
}`;

export async function fetchRailwayDeploy(
  token: string | undefined,
  serviceId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<RailwayDeployStatus | null> {
  if (!token || !serviceId) return null;
  try {
    const response = await fetchImpl(RAILWAY_GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: DEPLOYMENTS_QUERY, variables: { serviceId } }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { deployments?: { edges?: Array<{ node?: { status?: string; createdAt?: string; staticUrl?: string } }> } };
    };
    const node = body.data?.deployments?.edges?.[0]?.node;
    if (!node?.status) return null;
    return {
      status: node.status,
      createdAt: node.createdAt ?? null,
      url: node.staticUrl ? `https://${node.staticUrl}` : null,
    };
  } catch {
    return null; // network problems degrade to "unknown", never to a broken page
  }
}

/** Railway statuses that mean the service is NOT serving. */
export function deployLooksBroken(status: string): boolean {
  return ['FAILED', 'CRASHED', 'REMOVED', 'SLEEPING'].includes(status.toUpperCase());
}
