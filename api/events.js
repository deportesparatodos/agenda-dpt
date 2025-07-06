import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

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

// Mapeo agrupado de canales
const channelsGrouped = {
    'ESPN': ['espn-b', 'espn-c', 'espn-a', 'espn-d', 'espn1'],
    'ESPN 2': ['espn2-a', 'espn2-b', 'espn2-c', 'espn2-d', 'espn2'],
    'ESPN 3': ['espn3-a', 'espn3-b', 'espn3-c', 'espn3-d', 'espn3'],
    'ESPN 4': ['espn4-a', 'espn4-b', 'espn4-c', 'espn4-d', 'espn4'],
    'ESPN 5': ['espn5-a', 'espn5-b', 'espn5-c', 'espn5-d', 'espn5'],
    'ESPN 6': ['espn6-a', 'espn6-b', 'espn6-c', 'espn6-d', 'espn6'],
    'ESPN 7': ['espn7-a', 'espn7-b', 'espn7-c', 'espn7-d', 'espn7'],
    'ESPNDEPORTES': ['espndeportes-a'],
    'ESPN DEPORTES': ['espndeportes-a'],
    'ESPN PREMIUM': ['espn-premium-a', 'espn-premium-b', 'espn-premium-c', 'espn-premium-d', 'espnpremium'],
    'TNT SPORTS': ['tnt-a', 'tnt-b', 'tnt-c', 'tnt-d', 'tntsports'],
    'TYC SPORTS': ['tyc-a', 'tyc-b', 'tyc-c', 'tyc-d'],
    'FOX SPORTS': ['fox-a', 'fox-b', 'fox-c', 'fox-d', 'foxsports'],
    'FOX SPORTS 2': ['fox2-a', 'fox2-b', 'fox2-c', 'fox2-d', 'foxsports2'],
    'FOX SPORTS 3': ['fox3-a', 'fox3-b', 'fox3-c', 'fox3-d', 'foxsports3'],
    'DIRECTV SPORTS': ['dtv-a', 'dtv-b', 'dtv-c'],
    'DIRECTV SPORTS 2': ['dtv2-a', 'dtv2-b', 'dtv2-c'],
    'DIRECTV SPORTS PLUS': ['dtvplus-a', 'dtvplus-b', 'dtvplus-c'],
    'TV PUBLICA': ['tvp-a', 'tvp-b', 'tvp-c', 'tvp-d'],
    'TELEFE': ['telefe-a', 'telefe-b', 'telefe-c', 'telefe-d'],
    'VTV URUGUAY': ['vtv-a', 'vtv-b', 'vtv-c', 'vtv-d'],
    'VTV PLUS URUGUAY': ['vtvplus-a', 'vtvplus-b', 'vtvplus-c', 'vtvplus-d'],
    'WINSPORTS': ['winsports-a', 'winsports-b'],
    'WINSPORTS PLUS': ['winsportsplus-a', 'winsportsplus-b'],
    'LIGA 1 MAX PERU': ['l1max-a', 'l1max-b'],
    'GOL PERU': ['golperu'],
    'LATINA PERU': ['latinape'],
    'AMERICA TV PERU': ['americatvpe'],
    'ATV PERU': ['atv'],
    'CARACOL TV': ['caracoltv'],
    'TIGO SPORTS PARAGUAY': ['tigosportspy-a', 'tigosportspy-b'],
    'FOX SPORTS PREMIUM MX': ['foxsportspremium-a', 'foxsportspremium-b', 'foxsportspremium-c'],
    'FOX SPORTS MEXICO': ['foxmx-a', 'foxmx-b', 'foxmx-c'],
    'FOX SPORTS 2 MEXICO': ['foxmx2-a', 'foxmx2-b', 'foxmx2-c'],
    'FOX SPORTS 3 MEXICO': ['foxmx3-a', 'foxmx3-b', 'foxmx3-c'],
    'ESPN MEXICO': ['espnmx'],
    'ESPN 2 MEXICO': ['espn2mx'],
    'ESPN 3 MEXICO': ['espn3mx'],
    'FORMULA 1': ['f1-a', 'f1-b'],
    'DAZN FORMULA 1': ['daznf1', 'daznmgp'],
    'INDYCAR': ['indycar', 'auftv'],
    'INDYNXT': ['indynxt'],
    'NASCAR CUP': ['cup', 'cup2'],
    'RALLY': ['rally', 'rally2', 'rallytv'],
    'SUPERFORMULA': ['superformula'],
    'DAZN LA LIGA': ['daznlaliga'],
    'DAZN 1 ESPAÑA': ['daznes1'],
    'DAZN 2 ESPAÑA': ['daznes2'],
    'DAZN 3 ESPAÑA': ['daznes3'],
    'DAZN 4 ESPAÑA': ['daznes4'],
    'BUNDESLIGA 1': ['bundesliga1'],
    'BUNDESLIGA 2': ['bundesliga2'],
    'BUNDESLIGA 3': ['bundesliga3'],
    'BUNDESLIGA 4': ['bundesliga4'],
    'BUNDESLIGA 5': ['bundesliga5'],
    'SPORT TV 1 PORTUGAL': ['sporttv1'],
    'SPORT TV 2 PORTUGAL': ['sporttv2'],
    'SPORT TV 3 PORTUGAL': ['sporttv3'],
    'SPORT TV 4 PORTUGAL': ['sporttv4'],
    'SPORT TV 5 PORTUGAL': ['sporttv5'],
    'SPORT TV 6 PORTUGAL': ['sporttv6'],
    'TNT UK 1': ['tntuk'],
    'TNT UK 2': ['tntuk2'],
    'TNT UK 3': ['tntuk3'],
    'TNT UK 4': ['tntuk4'],
    'EUROSPORTS 1': ['eurosports1-a', 'eurosports1-b'],
    'EUROSPORTS 2': ['eurosports2-a', 'eurosports2-b'],
    'MLS 1': ['mls1'],
    'MLS 2': ['mls2'],
    'MLS 3': ['mls3'],
    'MLS 4': ['mls4'],
    'MLS 5': ['mls5'],
    'MLS 6': ['mls6'],
    'MLS 7': ['mls7'],
    'MLS 8': ['mls8'],
    'MLS 9': ['mls9'],
    'MLS 10': ['mls10'],
    'MLS 11': ['mls11'],
    'MLS 12': ['mls12'],
    'MLS 13': ['mls13'],
    'MLS 14': ['mls14'],
    'NBA 1': ['nba1-a', 'nba1-b'],
    'NBA 2': ['nba2-a', 'nba2-b'],
    'NBA 3': ['nba3-a', 'nba3-b'],
    'NBA 4': ['nba4-a', 'nba4-b'],
    'NBA 5': ['nba5-a', 'nba5-b'],
    'NBA 6': ['nba6-a', 'nba6-b'],
    'NBA 7': ['nba7-a', 'nba7-b'],
    'NBA 8': ['nba8-a', 'nba8-b'],
    'NBA 9': ['nba9-a', 'nba9-b'],
    'NBA 10': ['nba10-a', 'nba10-b'],
    'NBA 11': ['nba11-a', 'nba11-b'],
    'NBA 12': ['nba12-a', 'nba12-b'],
    'NBA 13': ['nba13-a', 'nba13-b'],
    'NBA 14': ['nba14-a', 'nba14-b'],
    'MLB 1': ['mlb1-a', 'mlb1-b'],
    'MLB 2': ['mlb2-a', 'mlb2-b'],
    'MLB 3': ['mlb3-a', 'mlb3-b'],
    'MLB 4': ['mlb4-a', 'mlb4-b'],
    'MLB 5': ['mlb5-a', 'mlb5-b'],
    'MLB 6': ['mlb6-a', 'mlb6-b'],
    'MLB 7': ['mlb7-a', 'mlb7-b'],
    'MLB 8': ['mlb8-a', 'mlb8-b'],
    'MLB 9': ['mlb9-a', 'mlb9-b'],
    'MLB 10': ['mlb10-a', 'mlb10-b'],
    'MLB 11': ['mlb11-a', 'mlb11-b'],
    'MLB 12': ['mlb12-a', 'mlb12-b'],
    'MLB 13': ['mlb13-a', 'mlb13-b'],
    'MLB 14': ['mlb14-a', 'mlb14-b'],
    'GRAN HERMANO 24HS': ['24hs'],
    'GRAN HERMANO CAMARA 1': ['camara1'],
    'GRAN HERMANO CAMARA 2': ['camara2'],
    'GRAN HERMANO CAMARA 3': ['camara3'],
    'GRAN HERMANO MULTICAM': ['ghmulticam'],
    'DISNEY': ['disney1-a', 'disney1-b', 'disneyplus-1'],
    'WWE': ['wwe'],
    'USA NETWORK': ['usanetwork-a', 'usanetwork-b'],
    'NETFLIX 1': ['netflix1'],
    'NETFLIX 2': ['netflix2'],
    'EVENTOS': ['eventos1','eventos2','eventos3','eventos4','eventos5','eventos6','eventos7','eventos8','eventos9','eventos10','eventos11','eventos12','eventos13','eventos14','eventos15', 'transmi1', 'transmi2', 'transmi3', 'transmi4', 'transmi5', 'transmi6', 'transmi7', 'transmi8', 'transmi9', 'transmi10', 'transmi11', 'transmi12', 'transmi13', 'transmi14', 'transmi15', 'transmi16', 'transmi17', 'transmi18', 'transmi19', 'transmi20', 'transmi21', 'transmi22', 'transmi23'],
    'TRANSMISIONES ESPECIALES': ['especial', 'especial2'],
    'MULTICAMARA': ['multicam', 'multi-f1', 'multi-2'],
    'tv-1': ['tv1'],
    'tv-2': ['tv2'],
    'tv-3': ['tv3'],
    'tv-4': ['tv4'],
    'tv-5': ['tv5'],
    'VTVPLUS': ['vtvplus-a'],
};

function normalizeChannelName(name) {
    return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeChannelForFallback(name) {
    // Quita espacios, pasa a minúsculas y elimina caracteres no alfanuméricos
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFirstChannelKey(name) {
    // Normaliza y busca coincidencia exacta
    const clean = normalizeChannelName(name);
    // 1. Coincidencia exacta
    for (const key in channelsGrouped) {
        if (normalizeChannelName(key) === clean) {
            return channelsGrouped[key][0];
        }
    }
    // 2. Coincidencia por inicio de string
    for (const key in channelsGrouped) {
        if (normalizeChannelName(key).startsWith(clean)) {
            return channelsGrouped[key][0];
        }
    }
    // 3. Fallback: devolver el nombre normalizado para usar como canal
    return null;
}

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 * MODIFIED: Acepta un objeto de configuración con las URLs dinámicas.
 */
async function fetchAlanGuloTVEvents(config) {
    const { agendaUrl, linkDomain, baseOrigin } = config;
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
                // Extraer la imagen principal del evento
                let imageUrl = '';
                // Buscar primero .event-logo, si no existe, buscar .team-logo
                const $eventLogo = $container.find('img.event-logo');
                if ($eventLogo.length > 0) {
                    imageUrl = $eventLogo.attr('src') || '';
                } else {
                    const $teamLogo = $container.find('img.team-logo');
                    if ($teamLogo.length > 0) {
                        imageUrl = $teamLogo.attr('src') || '';
                    }
                }
                // Si la URL es relativa, hacerla absoluta usando el dominio dinámico
                if (imageUrl && imageUrl.startsWith('/')) {
                    imageUrl = `https://${linkDomain}${imageUrl}`;
                }
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
                // FORZAR imagen MLB si el título contiene MLB (ahora con URL dinámica)
                if (title.toUpperCase().includes('MLB')) {
                    imageUrl = `https://${linkDomain}/mlb`;
                }
                // Buscar el contenedor de enlaces (siguiente elemento hermano)
                const $linksContainer = $container.next('.links-container');
                const links = [];
                if ($linksContainer.length > 0) {
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        let buttonName = $link.text().trim();
                        if (!buttonName) buttonName = 'CANAL';
                        let finalLink;
                        // Si el href es /canal/xxx/ o https://.../canal/xxx/ extraer xxx y usarlo como key
                        let canalKey = null;
                        const canalMatch = href && href.match(/\/canal\/([a-zA-Z0-9\-]+)\//);
                        if (canalMatch) {
                            canalKey = canalMatch[1].replace(/-/g, '');
                        }
                        let channelKey = null;
                        if (canalKey) {
                            // Buscar en el mapeo por fallback normalizado
                            for (const key in channelsGrouped) {
                                if (normalizeChannelForFallback(key) === canalKey.toLowerCase()) {
                                    channelKey = channelsGrouped[key][0];
                                    break;
                                }
                            }
                            if (!channelKey) channelKey = canalKey;
                        } else {
                            channelKey = normalizeChannelForFallback(buttonName);
                        }
                        // Si el canal es disney1, disney2, etc, agregar '-a' al final
                        if (/^disney\d+$/i.test(channelKey)) {
                            channelKey = channelKey + '-a';
                        }
                        
                        finalLink = `https://${linkDomain}/?channel=${channelKey}`;
                        
                        // REEMPLAZOS ESPECIALES (ahora dinámicos)
                        if (channelKey === 'disneyextensinpc') {
                            finalLink = `https://${linkDomain}/?channel=transmi1`;
                        } else if (channelKey === 'foxsportsmx') {
                            finalLink = `https://${linkDomain}/?channel=foxmx-a`;
                        } else if (channelKey === 'directv') {
                            finalLink = `https://${linkDomain}/?channel=dtv-a`;
                        } else if (channelKey === 'foxdeportes') { // Reemplazo especial de tu pedido
                            finalLink = `https://${linkDomain}/?channel=foxdeportes-a`;
                        }

                        // REEMPLAZO FINAL SEGÚN TU PEDIDO (ahora dinámico)
                        if (channelKey === 'telemetraoficialdealangulotv') {
                            finalLink = 'https://alangulo-dashboard-f1.vercel.app/';
                            buttonName = 'TELEMETRIA OFICIAL';
                        } else if (channelKey === 'multif1') {
                            finalLink = `${baseOrigin}/canal/multi-f1/`;
                            buttonName = 'MULTICAM (ALANGULOTV)';
                        }

                        // Si el link final es uno de los dos especiales, forzar el nombre del botón aunque sea 'OPCION'
                        if (finalLink === `${baseOrigin}/canal/multi-f1/`) {
                            buttonName = 'MULTICAM (ALANGULOTV)';
                        }
                        if (finalLink === 'https://alangulo-dashboard-f1.vercel.app/') {
                            buttonName = 'TELEMETRIA OFICIAL';
                        }
                        
                        links.push({
                            name: buttonName,
                            url: finalLink
                        });
                    });
                }
                
                // Solo agregar eventos que tengan enlaces
                if (links.length > 0) {
                    links.forEach(linkObj => {
                        events.push({
                            time: time,
                            title: title,
                            link: linkObj.url,
                            button: linkObj.name, // SIEMPRE el texto real del canal
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: imageUrl // NUEVO: imagen del evento
                        });
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
        
        // Fallback: intentar con regex si Cheerio falla
        try {
            console.log('Intentando método fallback con regex...');
            return await fetchAlanGuloTVFallback(config); // Pasar config al fallback
        } catch (fallbackError) {
            console.error('Método fallback también falló:', fallbackError);
            return [];
        }
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const events = [];
    
    // Regex para encontrar match-container y links-container
    const containerRegex = /<div class="match-container"[^>]*>(.*?)<\/div>\s*<div class="links-container"[^>]*>(.*?)<\/div>/gs;
    let match;
    
    while ((match = containerRegex.exec(html)) !== null) {
        const matchHTML = match[1];
        const linksHTML = match[2];
        
        try {
            // Extraer hora
            const timeMatch = matchHTML.match(/<span class="time"[^>]*>([^<]+)<\/span>/);
            const time = timeMatch ? timeMatch[1].trim() : '00:00';
            
            // Extraer equipos/títulos
            const teamMatches = [...matchHTML.matchAll(/<span class="team-name"[^>]*>([^<]+)<\/span>/g)];
            const team1 = teamMatches[0] ? teamMatches[0][1].trim() : '';
            const team2 = teamMatches[1] ? teamMatches[1][1].trim() : '';
            
            // Crear título
            let title = '';
            if (team1 && team2) {
                title = `${team1} vs ${team2}`;
            } else if (team1) {
                title = team1;
            } else {
                title = 'Evento sin título';
            }
            
            // Extraer enlaces
            const linkMatches = [...linksHTML.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
            
            linkMatches.forEach(linkMatch => {
                const href = linkMatch[1];
                const linkText = linkMatch[2].trim();
                
                if (href && linkText) {
                    const fullUrl = href.startsWith('/') 
                        ? `${baseOrigin}${href}` 
                        : href;
                    const urlWithStream = `${fullUrl}?stream=${encodeURIComponent(linkText)}`;
                    
                    events.push({
                        time: time,
                        title: title,
                        link: urlWithStream,
                        category: 'Deportes',
                        language: 'Español',
                        date: new Date().toISOString().split('T')[0],
                        source: 'alangulotv'
                    });
                }
            });
        } catch (error) {
            console.error('Error en fallback regex:', error);
        }
    }
    
    return events;
}

// Extrae el objeto channels de la página de canal
async function fetchChannelsObject(baseOrigin, canalKey) {
    try {
        const url = `${baseOrigin}/canal/${canalKey}/`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        // Buscar el bloque de JS que contiene 'const channels = {...};'
        const match = html.match(/const channels\s*=\s*(\{[\s\S]*?\});/);
        if (match && match[1]) {
            // Evaluar el objeto de forma segura
            // eslint-disable-next-line no-new-func
            const channels = Function(`"use strict";return (${match[1]})`)();
            return channels;
        }
    } catch (e) {
        console.error('No se pudo extraer channels para', canalKey, e);
    }
    return null;
}

export default async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Iniciando obtención de eventos...');
        const alanGuloConfig = await getDynamicAlanGuloConfig();
        // Solo obtener eventos de AlanGuloTV
        const alanGuloEvents = await fetchAlanGuloTVEvents(alanGuloConfig);
        // Procesar cada evento para reemplazar links de botones
        const processedEvents = [];
        for (const event of alanGuloEvents) {
            // Si el link es /canal/xxx/ o https://.../canal/xxx/ extraer xxx
            let canalKey = null;
            const canalMatch = event.link && event.link.match(/\/canal\/([a-zA-Z0-9\-]+)\//);
            if (canalMatch) {
                canalKey = canalMatch[1];
            }
            let newLink = event.link;
            if (canalKey) {
                // Obtener el objeto channels de la página de canal
                const channelsObj = await fetchChannelsObject(alanGuloConfig.baseOrigin, canalKey);
                if (channelsObj && channelsObj[canalKey]) {
                    // Tomar la PRIMERA opción (repro1)
                    const firstKey = Object.keys(channelsObj[canalKey])[0];
                    if (firstKey) {
                        newLink = channelsObj[canalKey][firstKey];
                    }
                }
            }
            processedEvents.push({
                ...event,
                link: newLink
            });
        }
        return res.status(200).json(processedEvents);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};