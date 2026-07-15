import type { KnowledgeGraph } from '@orion/models';

export interface HtmlExportOptions {
  title?: string;
  aggregationThreshold?: number;
}

const COMMUNITY_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function graphDataJson(graph: KnowledgeGraph): object {
  const communityCounts = new Map<number, { count: number; name: string }>();
  for (const node of graph.nodes) {
    if (node.community !== undefined) {
      const existing = communityCounts.get(node.community);
      if (existing) {
        existing.count++;
      } else {
        communityCounts.set(node.community, {
          count: 1,
          name: node.communityName ?? `Community ${node.community}`,
        });
      }
    }
  }

  const communities = Array.from(communityCounts.entries())
    .map(([id, info]) => ({ id, label: info.name, size: info.count }))
    .sort((a, b) => b.size - a.size);

  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      fileType: n.fileType,
      sourceFile: n.sourceFile,
      sourceLocation: n.sourceLocation ?? '',
      community: n.community,
      communityName: n.communityName ?? '',
      degree: n.degree ?? 0,
    })),
    links: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: e.confidence,
    })),
    communities,
    stats: graph.stats ?? null,
  };
}

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
body { display: flex; }
#sidebar { width: 320px; min-width: 320px; height: 100vh; overflow-y: auto; background: #1a1a2e; color: #eee; display: flex; flex-direction: column; border-right: 1px solid #333; }
#search-container { padding: 12px; border-bottom: 1px solid #333; }
#search { width: 100%; padding: 8px 12px; border: 1px solid #444; border-radius: 6px; background: #16213e; color: #eee; font-size: 14px; outline: none; }
#search:focus { border-color: #1f77b4; }
#info-panel { flex: 1; padding: 12px; border-bottom: 1px solid #333; overflow-y: auto; }
#info-panel h3 { font-size: 13px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }
#info-content { font-size: 13px; line-height: 1.6; }
#info-content .info-row { margin-bottom: 6px; }
#info-content .info-label { color: #888; font-weight: 600; }
#info-content .info-value { color: #ccc; word-break: break-all; }
#info-content .info-connections { margin-top: 8px; }
#info-content .conn-item { font-size: 12px; padding: 2px 0; color: #aaa; }
#legend { padding: 12px; }
#legend h3 { font-size: 13px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }
.legend-item { display: flex; align-items: center; padding: 4px 0; cursor: pointer; font-size: 12px; color: #ccc; }
.legend-item:hover { color: #fff; }
.legend-item.hidden { opacity: 0.4; }
.legend-swatch { width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; flex-shrink: 0; }
.legend-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend-count { margin-left: auto; color: #666; font-size: 11px; padding-left: 8px; }
#graph-container { flex: 1; height: 100vh; background: #0f0f23; position: relative; }
#graph-container svg { width: 100%; height: 100%; }
.tooltip { position: absolute; padding: 6px 10px; background: rgba(0,0,0,0.85); color: #eee; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 1000; max-width: 300px; word-wrap: break-word; }
`;

const JS_TEMPLATE = `
(function() {
  const container = document.getElementById('graph-container');
  const svg = d3.select('#graph-container svg');
  const width = container.clientWidth;
  const height = container.clientHeight;

  const simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(function(d) { return d.id; }).distance(50))
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const g = svg.append('g');

  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', function(event) {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  const link = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .join('line')
    .attr('stroke', '#333')
    .attr('stroke-width', 0.5)
    .attr('stroke-opacity', 0.6);

  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('circle')
    .data(data.nodes)
    .join('circle')
    .attr('r', function(d) { return Math.sqrt(Math.log(d.degree + 1)) * 2.5 + 3; })
    .attr('fill', function(d) {
      if (d.community === undefined) return '#555';
      return communityColor(d.community);
    })
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.5)
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded));

  const tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

  node.on('mouseover', function(event, d) {
    tooltip.transition().duration(200).style('opacity', 0.9);
    tooltip.html(escapeHtml(d.label))
      .style('left', (event.pageX + 10) + 'px')
      .style('top', (event.pageY - 10) + 'px');
  })
  .on('mousemove', function(event) {
    tooltip.style('left', (event.pageX + 10) + 'px')
      .style('top', (event.pageY - 10) + 'px');
  })
  .on('mouseout', function() {
    tooltip.transition().duration(300).style('opacity', 0);
  })
  .on('click', function(event, d) {
    event.stopPropagation();
    showNodeInfo(d);
    highlightNode(d);
  });

  svg.on('click', function() {
    clearHighlight();
    document.getElementById('info-content').innerHTML = '<span style="color:#666;">Click a node to inspect</span>';
  });

  simulation.on('tick', function() {
    link
      .attr('x1', function(d) { return d.source.x; })
      .attr('y1', function(d) { return d.source.y; })
      .attr('x2', function(d) { return d.target.x; })
      .attr('y2', function(d) { return d.target.y; });

    node
      .attr('cx', function(d) { return d.x; })
      .attr('cy', function(d) { return d.y; });
  });

  window.addEventListener('resize', function() {
    var w = container.clientWidth;
    var h = container.clientHeight;
    svg.attr('viewBox', null);
    simulation.force('center', d3.forceCenter(w / 2, h / 2));
    simulation.alpha(0.3).restart();
  });

  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  function communityColor(communityId) {
    var colors = ${JSON.stringify(COMMUNITY_COLORS)};
    return colors[communityId % colors.length];
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function showNodeInfo(d) {
    var neighbors = data.links.filter(function(l) {
      return l.source.id === d.id || l.target.id === d.id || l.source === d.id || l.target === d.id;
    });
    var neighborIds = new Set();
    neighbors.forEach(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      if (sid !== d.id) neighborIds.add(sid);
      if (tid !== d.id) neighborIds.add(tid);
    });

    var html = '<div class="info-row"><span class="info-label">Label:</span> <span class="info-value">' + escapeHtml(d.label) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">File:</span> <span class="info-value">' + escapeHtml(d.sourceFile) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Type:</span> <span class="info-value">' + escapeHtml(d.fileType) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Community:</span> <span class="info-value">' + (d.communityName || (d.community !== undefined ? 'Community ' + d.community : 'None')) + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Degree:</span> <span class="info-value">' + d.degree + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Connections:</span> <span class="info-value">' + neighborIds.size + '</span></div>';

    if (neighborIds.size > 0) {
      html += '<div class="info-connections"><span class="info-label">Connected to:</span>';
      var connList = Array.from(neighborIds).slice(0, 20);
      connList.forEach(function(nid) {
        var node = data.nodes.find(function(n) { return n.id === nid; });
        var label = node ? node.label : nid;
        html += '<div class="conn-item">' + escapeHtml(label) + '</div>';
      });
      if (neighborIds.size > 20) {
        html += '<div class="conn-item" style="color:#666;">... and ' + (neighborIds.size - 20) + ' more</div>';
      }
      html += '</div>';
    }

    document.getElementById('info-content').innerHTML = html;
  }

  function highlightNode(d) {
    node.attr('opacity', 0.15);
    link.attr('opacity', 0.05);

    var connected = new Set();
    connected.add(d.id);

    link.each(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      if (sid === d.id) connected.add(tid);
      if (tid === d.id) connected.add(sid);
    });

    node.filter(function(n) { return connected.has(n.id); })
      .attr('opacity', 1);

    link.filter(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      return sid === d.id || tid === d.id;
    })
      .attr('opacity', 0.8)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);
  }

  function clearHighlight() {
    node.attr('opacity', 1);
    link.attr('opacity', 0.6)
      .attr('stroke', '#333')
      .attr('stroke-width', 0.5);
  }

  var searchInput = document.getElementById('search');
  searchInput.addEventListener('input', function() {
    var query = this.value.toLowerCase().trim();

    if (query === '') {
      clearHighlight();
      return;
    }

    node.attr('opacity', 0.15);
    link.attr('opacity', 0.05);

    var matched = new Set();
    node.each(function(d) {
      if (d.label.toLowerCase().indexOf(query) !== -1) {
        matched.add(d.id);
      }
    });

    node.filter(function(d) { return matched.has(d.id); })
      .attr('opacity', 1);

    link.filter(function(l) {
      var sid = l.source.id || l.source;
      var tid = l.target.id || l.target;
      return matched.has(sid) || matched.has(tid);
    })
      .attr('opacity', 0.6)
      .attr('stroke', '#1f77b4')
      .attr('stroke-width', 1);
  });

  function buildLegend() {
    var container = document.getElementById('legend-content');
    var hiddenCommunities = new Set();

    data.communities.forEach(function(c) {
      var item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = '<span class="legend-swatch" style="background:' + communityColor(c.id) + ';"></span>' +
        '<span class="legend-label">' + escapeHtml(c.label) + '</span>' +
        '<span class="legend-count">' + c.size + '</span>';

      item.addEventListener('click', function() {
        if (hiddenCommunities.has(c.id)) {
          hiddenCommunities.delete(c.id);
          item.classList.remove('hidden');
        } else {
          hiddenCommunities.add(c.id);
          item.classList.add('hidden');
        }

        node.attr('opacity', function(d) {
          if (hiddenCommunities.size === 0) return 1;
          if (d.community === undefined) return hiddenCommunities.size === 0 ? 1 : 0.08;
          return hiddenCommunities.has(d.community) ? 0.08 : 1;
        });

        link.attr('opacity', function(l) {
          if (hiddenCommunities.size === 0) return 0.6;
          var sid = l.source.id || l.source;
          var tid = l.target.id || l.target;
          var sn = data.nodes.find(function(n) { return n.id === sid; });
          var tn = data.nodes.find(function(n) { return n.id === tid; });
          var sc = sn ? sn.community : undefined;
          var tc = tn ? tn.community : undefined;
          if (sc !== undefined && hiddenCommunities.has(sc)) return 0.03;
          if (tc !== undefined && hiddenCommunities.has(tc)) return 0.03;
          return 0.3;
        });
      });

      container.appendChild(item);
    });
  }

  buildLegend();
})();
`;

export function generateHtml(graph: KnowledgeGraph, opts?: HtmlExportOptions): string {
  const title = opts?.title ?? 'Knowledge Graph';

  const data = graphDataJson(graph);
  const dataJson = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="sidebar">
  <div id="search-container">
    <input type="text" id="search" placeholder="Search nodes..." autocomplete="off" />
  </div>
  <div id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span style="color:#666;">Click a node to inspect</span></div>
  </div>
  <div id="legend">
    <h3>Communities</h3>
    <div id="legend-content"></div>
  </div>
</div>
<div id="graph-container">
  <svg></svg>
</div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
var data = ${dataJson};
${JS_TEMPLATE}
</script>
</body>
</html>`;
}
