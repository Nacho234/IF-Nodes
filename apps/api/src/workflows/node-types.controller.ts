import { Controller, Get, UseGuards } from '@nestjs/common';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { SessionGuard } from '../auth/guards';

/**
 * Catálogo de tipos de nodo para la biblioteca del constructor.
 * Expone solo metadatos (nunca los executors).
 */
@UseGuards(SessionGuard)
@Controller('node-types')
export class NodeTypesController {
  @Get()
  list() {
    return nodeRegistry.all().map((definition) => ({
      type: definition.type,
      version: definition.version,
      category: definition.category,
      displayName: definition.displayName,
      description: definition.description,
      icon: definition.icon,
      inputs: definition.inputs,
      outputs: definition.outputs,
      defaultConfig: definition.defaultConfig,
      uiHints: definition.uiHints,
      outputVariables: definition.outputVariables ?? [],
      documentation: definition.documentation ?? '',
      exportable: definition.exportable,
    }));
  }
}
