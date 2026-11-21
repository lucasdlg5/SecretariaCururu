import { Octokit } from '@octokit/rest';
import { createSanitizedLogger } from '@secretaria/shared';

const logger = createSanitizedLogger('github-trigger');

export interface TriggerWorkflowInput {
  providerId?: string;
  providerName?: string;
  referenceMonth?: string;
  forceRun?: boolean;
}

export class GitHubActionsTriggerService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private workflowId: string;
  private ref: string;

  constructor(options?: {
    pat?: string;
    owner?: string;
    repo?: string;
    workflowId?: string;
    ref?: string;
  }) {
    const auth = options?.pat ?? process.env.GITHUB_PAT ?? '';
    this.owner = options?.owner ?? process.env.GITHUB_OWNER ?? 'lucasdlg5';
    this.repo = options?.repo ?? process.env.GITHUB_REPO ?? 'SecretariaCururu';
    this.workflowId =
      options?.workflowId ?? process.env.GITHUB_WORKFLOW_ID ?? 'daily_reconcile.yml';
    this.ref = options?.ref ?? process.env.GITHUB_REF ?? 'main';

    this.octokit = new Octokit({ auth: auth || undefined });
  }

  /**
   * Triggers `.github/workflows/daily_reconcile.yml` via `workflow_dispatch`
   * so Playwright runs on GitHub Actions runners instead of Render's 512MB RAM container.
   */
  async dispatchReconcileWorkflow(input: TriggerWorkflowInput = {}): Promise<{
    dispatched: boolean;
    workflowId: string;
    ref: string;
  }> {
    if (!process.env.GITHUB_PAT) {
      throw new Error('GITHUB_PAT não configurado no ambiente para acionar o GitHub Actions.');
    }

    const inputs: Record<string, string> = {};
    if (input.providerId) inputs.provider_id = input.providerId;
    if (input.providerName) inputs.provider_name = input.providerName;
    if (input.referenceMonth) inputs.reference_month = input.referenceMonth;
    if (input.forceRun !== undefined) inputs.force_run = String(input.forceRun);

    logger.info(
      {
        owner: this.owner,
        repo: this.repo,
        workflowId: this.workflowId,
        ref: this.ref,
        inputs,
      },
      'Acionando workflow_dispatch no GitHub Actions'
    );

    await this.octokit.actions.createWorkflowDispatch({
      owner: this.owner,
      repo: this.repo,
      workflow_id: this.workflowId,
      ref: this.ref,
      inputs,
    });

    return {
      dispatched: true,
      workflowId: this.workflowId,
      ref: this.ref,
    };
  }
}
