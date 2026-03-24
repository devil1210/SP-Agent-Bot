// import { Message } from './llm.js'; // Removed unused import

/**
 * Limpia la respuesta de la LLM extraendo solo el texto relevante
 * Ignora logs de sistema y metadatos
 */
export const cleanResponse = (content: any): string => {
    let text: string;
    
    if (!content) return '';
    
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        text = content.map(c => typeof c === 'string' ? c : '').join('\n');
    } else if (content && typeof content === 'object') {
        text = JSON.stringify(content);
    } else {
        text = String(content);
    }
    
    // Eliminar logs de pensamiento comunes
    const lines = text.split('\n');
    const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('[Agent:') && 
               !trimmed.startsWith('🧠') && 
               !trimmed.startsWith('🔍') && 
               !trimmed.startsWith('✨') &&
               !trimmed.startsWith('Procesando') &&
               !trimmed.startsWith('Re-procesando') &&
               !trimmed.startsWith('Iteración') &&
               !trimmed.startsWith('Memoria');
    });
    
    return filteredLines.join('\n').trim();
};

/**
 * Extrae solo la respuesta final después de "✨ Respuesta final lista" o similar
 */
export const extractFinalResponse = (text: string): string => {
    // Intentar extraer texto después de mensaje de éxito
    const patterns = [
        /✨ Respuesta final lista[^]*?(\n?)([^]*?)(?:\n?\n|\Z)/s,
        /Respuesta final lista[^]*?(\n?)([^]*?)(?:\n?\n|\Z)/s,
        /LONGITUD:\s*(\d+)/,
        /Longitud:\s*(\d+)/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const index = match.index || 0;
            const captured = match[1] || match[2] || '';
            
            // Limpiar el texto extraído
            let extracted = captured.trim();
            extracted = extracted
                .replace(/Memoria RSS:\s*\d+MB/s, '')
                .replace(/Longitud:\s*\d+ chars/s, '')
                .split('\n')
                .filter(l => !l.startsWith('[Agent:'))
                .join('\n')
                .trim();
            
            if (extracted) return extracted;
        }
    }
    
    // Si no hay patrones, devolver el texto limpio
    return cleanResponse(text);
};