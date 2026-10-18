export interface WorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  url: string;
}

export interface DevOpsConfig {
  organization: string;
  project: string;
}

const API = '7.1';

type RawWorkItem = {
  id: number;
  fields: Record<string, string>;
  _links?: { html?: { href?: string } };
};

/**
 * Minimal Azure DevOps REST client (work items). Authenticates with a PAT
 * (scope "Work Items: Read & write" only). The host is fixed, so there is no
 * user-controlled URL; redirects are refused.
 */
export class DevOpsClient {
  constructor(
    private readonly cfg: DevOpsConfig,
    private readonly pat: string,
    private readonly http: typeof fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(cfg.organization) || !cfg.project) {
      throw new Error('Azure DevOps is not configured');
    }
  }

  private headers(contentType = 'application/json') {
    return {
      authorization: `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`,
      'content-type': contentType,
      accept: 'application/json',
    };
  }

  private base() {
    return `https://dev.azure.com/${encodeURIComponent(this.cfg.organization)}`;
  }

  private parse(body: RawWorkItem): WorkItem {
    return {
      id: body.id,
      title: String(body.fields['System.Title'] ?? '').slice(0, 255),
      state: String(body.fields['System.State'] ?? '').slice(0, 60),
      type: String(body.fields['System.WorkItemType'] ?? '').slice(0, 40),
      url:
        body._links?.html?.href ??
        `${this.base()}/${encodeURIComponent(this.cfg.project)}/_workitems/edit/${body.id}`,
    };
  }

  async create(type: string, title: string, descriptionHtml: string): Promise<WorkItem> {
    const res = await this.http(
      `${this.base()}/${encodeURIComponent(this.cfg.project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=${API}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: this.headers('application/json-patch+json'),
        body: JSON.stringify([
          { op: 'add', path: '/fields/System.Title', value: title.slice(0, 255) },
          { op: 'add', path: '/fields/System.Description', value: descriptionHtml },
          { op: 'add', path: '/fields/System.Tags', value: 'mesa-soporte' },
        ]),
      },
    );
    if (!res.ok) throw new Error(`Azure DevOps create failed (${res.status})`);
    return this.parse((await res.json()) as RawWorkItem);
  }

  async get(id: number): Promise<WorkItem> {
    const res = await this.http(`${this.base()}/_apis/wit/workitems/${id}?api-version=${API}`, {
      redirect: 'error',
      headers: this.headers(),
    });
    if (res.status === 404) throw new Error('Work item not found');
    if (!res.ok) throw new Error(`Azure DevOps read failed (${res.status})`);
    return this.parse((await res.json()) as RawWorkItem);
  }
}
