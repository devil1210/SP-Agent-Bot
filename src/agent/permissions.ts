// ─────────────────────────────────────────────────────────────────────────────
// TOOL PERMISSION CONTEXT — Patrón SPcore-Nexus (permissions.py)
// Reemplaza el sistema ad-hoc de inferPermissionDenials con un contexto
// formal basado en deny_names + deny_prefixes.
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionDenial {
  tool_name: string;
  reason: string;
}

export class ToolPermissionContext {
  private denyNames: Set<string>;
  private denyPrefixes: string[];

  constructor(denyNames: Iterable<string>, denyPrefixes: string[] = []) {
    this.denyNames = new Set([...denyNames].map(n => n.toLowerCase()));
    this.denyPrefixes = denyPrefixes.map(p => p.toLowerCase());
  }

  /** True si la herramienta está bloqueada */
  blocks(toolName: string): boolean {
    const lower = toolName.toLowerCase();
    return this.denyNames.has(lower)
      || this.denyPrefixes.some(p => lower.startsWith(p));
  }

  /** Contexto para usuarios ADMIN (sin restricciones) */
  static forAdmin(): ToolPermissionContext {
    return new ToolPermissionContext([], []);
  }

  /** Contexto para usuarios EXTERNOS (máximas restricciones) */
  static forExternalUser(): ToolPermissionContext {
    return new ToolPermissionContext(
      [
        // Herramientas destructivas de mensajes
        'delete_messages', 'ban_user', 'send_admin_alert',
        'borrar_mensaje_propio', 'borrar_este_mensaje',
        'limpiar_ultimo_seguimiento', 'editar_mensaje_propio',
        'enviar_mensaje_grupo',
        // Herramientas de código/sistema
        'commit_and_push', 'modify_file', 'clone_repository',
        'spawn_coding_agent', 'run_coding_agent',
        'typescript_check', 'run_verification',
        // Herramientas de scaffold/templates
        'scaffold_plugin', 'create_agent_template',
        'log_pattern', 'postgres_check_schema',
        // GitHub
        'gh_pr_list',
      ],
      [
        'configurar_acceso_',  // Bloquea toda la familia de acceso
        'set_state',           // Estado emocional (admin only)
        'set_personality',     // Personalidad (admin only)
      ]
    );
  }

  /** Filtra herramientas y retorna las permitidas + denegaciones */
  filterTools(allTools: any[]): { allowed: any[]; denials: PermissionDenial[] } {
    const denials: PermissionDenial[] = [];
    const allowed = allTools.filter(tool => {
      const name: string = tool?.function?.name ?? tool?.name ?? '';
      if (this.blocks(name)) {
        denials.push({
          tool_name: name,
          reason: this.denyNames.has(name.toLowerCase())
            ? 'Herramienta restringida (deny list)'
            : 'Familia de herramientas restringida (deny prefix)',
        });
        return false;
      }
      return true;
    });

    if (denials.length > 0) {
      console.log(
        `[Agent:Permissions] 🛡️ ${denials.length} herramienta(s) denegada(s): ` +
        denials.map(d => d.tool_name).join(', ')
      );
    }

    return { allowed, denials };
  }
}
