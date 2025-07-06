import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * NEW: Detecta dinámicamente el dominio base de AlanGuloTV siguiendo redirecciones.
 * Esto evita tener que cambiar manualmente los dominios cuando expiran.
 */
async function getDynamicAlanGuloConfig() {
    const mainUrl = 'https://alangulotv.live';
    try {
        const response = await fetch(mainUrl, {
            redirect: 'follow',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const finalUrl = new URL(response.url);
        const baseDomain = finalUrl.hostname; // e.g., alangulotv.space
        const linkDomain = `p.${baseDomain}`;   // e.g., p.alangulotv.space
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;

        console.log(`Dominio de AlanGuloTV detectado: ${baseDomain}`);

        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    } catch (error) {
        console.error('No se pudo obtener el dominio dinámico de AlanGuloTV. Usando valores por defecto.', error);
        // Fallback a los últimos dominios conocidos para no romper la API
        const baseDomain = 'alangulotv.space';
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    }
}


function adjustTimeZone(time, date) {
    if (!time || !date) return time || '00:00';

    try {
        const [hour, minute] = time.split(':').map(Number);
        
        if (isNaN(hour) || isNaN(minute)) return time;

        // Ajustar hora: +2 horas desde el horario de Lima
        let adjustedHour = hour + 2;
        
        // Manejar el cambio de día si es necesario
        if (adjustedHour >= 24) {
            adjustedHour -= 24;
        }

        // Formato de dos dígitos para hora y minutos
        return `${String(adjustedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch (error) {
        console.error('Error al ajustar zona horaria:', error);
        return time;
    }
}

// Devuelve SIEMPRE el estado 'raw' (sin calcular) y deja que el frontend lo calcule
function determineEventStatus(eventTime, eventDate) {
    return null; // No calcular aquí, lo hará el frontend
}

/**
 * Función para hacer scraping de streamtpglobal.com
 */
async function fetchStreamTpGlobalEvents() {
    try {
        console.log('Fetching StreamTpGlobal eventos JSON...');
        const response = await fetch('https://streamtpglobal.com/eventos.json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
        const events = await response.json();
        console.log(`StreamTpGlobal: ${events.length} eventos obtenidos.`);
        
        return events.map(event => ({
            ...event,
            source: 'streamtpglobal'
        }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 * Extrae los links y los reemplaza por el primer link del mapeo si corresponde.
 */
async function fetchAlanGuloTVEvents(config) {
    const { agendaUrl } = config;
    // Leer el mapeo desde el JSON externo
    const channelLinkMapPath = path.join(__dirname, '../channelLinkMap.json');
    let channelLinkMap = {};
    try {
        channelLinkMap = JSON.parse(fs.readFileSync(channelLinkMapPath, 'utf8'));
    } catch (e) {
        console.error('No se pudo leer el mapeo de canales:', e);
    }
    try {
        console.log(`Fetching AlanGuloTV eventos desde ${agendaUrl}...`);
        const response = await fetch(agendaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: 15000
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        // Buscar contenedores de partidos
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                // Extraer la hora
                const timeText = $container.find('.time').text().trim();
                const time = timeText || '00:00';
                // Extraer nombres de equipos
                const teamNames = [];
                $container.find('.team-name').each((i, teamEl) => {
                    teamNames.push($(teamEl).text().trim());
                });
                const team1 = teamNames[0] || '';
                const team2 = teamNames[1] || '';
                // Crear título principal
                let title = '';
                if (team1 && team2) {
                    title = `${team1} vs ${team2}`;
                } else if (team1) {
                    title = team1;
                } else {
                    title = 'Evento sin título';
                }
                // Buscar el contenedor de enlaces (siguiente elemento hermano)
                const $linksContainer = $container.next('.links-container');
                if ($linksContainer.length > 0) {
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        let buttonName = $link.text().trim();
                        if (!buttonName) buttonName = 'CANAL';
                        let finalLink = href;
                        if (href) {
                            // Extraer la key del final del path
                            try {
                                const urlParts = href.split('/').filter(Boolean);
                                const key = urlParts[urlParts.length - 1];
                                if (key && channelLinkMap[key] && typeof channelLinkMap[key] === 'object') {
                                    // Tomar el primer value del objeto
                                    const firstLink = Object.values(channelLinkMap[key])[0];
                                    if (firstLink) {
                                        finalLink = firstLink;
                                    }
                                }
                            } catch (e) {}
                            events.push({
                                time: time,
                                title: title,
                                link: finalLink,
                                button: buttonName,
                                category: 'Deportes',
                                language: 'Español',
                                date: new Date().toISOString().split('T')[0],
                                source: 'alangulotv'
                            });
                        }
                    });
                }
            } catch (error) {
                console.error('Error procesando evento AlanGuloTV:', error);
            }
        });
        console.log(`AlanGuloTV: ${events.length} eventos obtenidos`);
        return events;
    } catch (error) {
        console.error('Error al obtener eventos de AlanGuloTV:', error);
        return [];
    }
}

/**
 * Método fallback usando regex para parsear AlanGuloTV
 * MODIFIED: Acepta config para usar URLs dinámicas.
 */
async function fetchAlanGuloTVFallback(config) {
    const { agendaUrl, baseOrigin } = config;

    const response = await fetch(agendaUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Expresiones regulares para extraer eventos
    const eventRegex = /<div class="match-container">.*?<div class="time">(.*?)<\/div>.*?<div class="team-name">(.*?)<\/div>.*?<div class="team-name">(.*?)<\/div>.*?<div class="links-container">(.*?)<\/div>/gs;
    const linkRegex = /href="(.*?)"/g;

    let match;
    const events = [];

    while ((match = eventRegex.exec(html)) !== null) {
        const time = match[1] || '00:00';
        const team1 = match[2] || 'Equipo 1';
        const team2 = match[3] || 'Equipo 2';
        const linksContainer = match[4] || '';

        // Extraer todos los enlaces del contenedor
        let links = [];
        let linkMatch;
        while ((linkMatch = linkRegex.exec(linksContainer)) !== null) {
            links.push(linkMatch[1]);
        }

        // Crear título principal
        let title = '';
        if (team1 && team2) {
            title = `${team1} vs ${team2}`;
        } else if (team1) {
            title = team1;
        } else {
            title = 'Evento sin título';
        }

        // Usar el primer enlace como principal
        let finalLink = links[0] || '';

        events.push({
            time: time,
            title: title,
            link: finalLink,
            button: 'CANAL',
            category: 'Deportes',
            language: 'Español',
            date: new Date().toISOString().split('T')[0],
            source: 'alangulotv'
        });
    }

    return events;
}

/**
 * Función principal para obtener eventos
 */
export async function fetchEvents() {
    // Primero, intentar obtener la configuración dinámica y los eventos de AlanGuloTV
    const config = await getDynamicAlanGuloConfig();
    let events = await fetchAlanGuloTVEvents(config);

    // Si no se obtuvieron eventos, intentar con el método fallback
    if (events.length === 0) {
        console.log('No se encontraron eventos en AlanGuloTV, intentando con método fallback...');
        events = await fetchAlanGuloTVFallback(config);
    }

    // Obtener y agregar eventos de StreamTpGlobal
    const streamTpGlobalEvents = await fetchStreamTpGlobalEvents();
    events = [...events, ...streamTpGlobalEvents];

    // Ajustar la fecha y hora de los eventos
    const now = new Date();
    events.forEach(event => {
        try {
            // Ajustar la fecha al día actual
            event.date = now.toISOString().split('T')[0];

            // Ajustar la hora (si es necesario)
            event.time = adjustTimeZone(event.time, event.date);
        } catch (e) {
            console.error('Error ajustando fecha/hora del evento:', e);
        }
    });

    return events;
}