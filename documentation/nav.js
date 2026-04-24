// ═══════════════════════════════════════════════════════════
// Nu-Map Documentation — Shared Navigation Generator
// ═══════════════════════════════════════════════════════════
// Each HTML page sets:  <body data-page="src/context/PlannerContext">
// This script reads that value, computes relative paths, and
// renders the full collapsible nav tree into #nav-tree.
// ═══════════════════════════════════════════════════════════
(function () {
  var TREE = {
    id: '', label: 'nu-map', type: 'root',
    children: [
      { id: 'architecture', label: 'architecture', type: 'js' },
      {
        id: 'src', label: 'src/', type: 'dir',
        children: [
          {
            id: 'src/ports', label: 'ports/', type: 'dir',
            children: [
              { id: 'src/ports/IAttributable',      label: 'IAttributable.js',       type: 'js' },
              { id: 'src/ports/IInstitution',       label: 'IInstitution.js',       type: 'js' },
              { id: 'src/ports/ICalendar',          label: 'ICalendar.js',           type: 'js' },
              { id: 'src/ports/ICreditSystem',      label: 'ICreditSystem.js',       type: 'js' },
              { id: 'src/ports/IAttributeSystem',   label: 'IAttributeSystem.js',    type: 'js' },
              { id: 'src/ports/ISpecialTerms',      label: 'ISpecialTerms.js',       type: 'js' },
              { id: 'src/ports/IMajorRequirements', label: 'IMajorRequirements.js',  type: 'js' },
              { id: 'src/ports/ICourseCatalog',     label: 'ICourseCatalog.js',      type: 'js' },
              { id: 'src/ports/ILocalization',      label: 'ILocalization.js',       type: 'js' }
            ]
          },
          {
            id: 'src/adapters', label: 'adapters/', type: 'dir',
            children: [
              { id: 'src/adapters/northeastern', label: 'northeastern/', type: 'dir', children: [] },
              { id: 'src/adapters/generic',      label: 'generic/',      type: 'dir', children: [] }
            ]
          },
          {
            id: 'src/context', label: 'context/', type: 'dir',
            children: [
              { id: 'src/context/InstitutionContext', label: 'InstitutionContext.jsx', type: 'jsx' },
              {
                id: 'src/context/PlannerContext', label: 'PlannerContext.jsx', type: 'jsx',
                children: [
                  { id: 'src/context/PlannerContext/drag-drop', label: 'drag-drop', type: 'js' },
                  { id: 'src/context/PlannerContext/svg-lines', label: 'svg-lines', type: 'js' },
                  { id: 'src/context/PlannerContext/plans',     label: 'plans',     type: 'js' }
                ]
              },
              { id: 'src/context/ThemeContext',   label: 'ThemeContext.jsx',   type: 'jsx' }
            ]
          },
          {
            id: 'src/core', label: 'core/', type: 'dir',
            children: [
              { id: 'src/core/gradRequirements',  label: 'gradRequirements.js',  type: 'js' },
              { id: 'src/core/prereqEval',        label: 'prereqEval.js',        type: 'js' },
              { id: 'src/core/courseModel',       label: 'courseModel.js',       type: 'js' },
              { id: 'src/core/semGrid',           label: 'semGrid.js',           type: 'js' },
              { id: 'src/core/planModel',         label: 'planModel.js',         type: 'js' },
              { id: 'src/core/specialTermUtils',  label: 'specialTermUtils.js',  type: 'js' },
              { id: 'src/core/constants',         label: 'constants + themes',   type: 'js' }
            ]
          },
          {
            id: 'src/data', label: 'data/', type: 'dir',
            children: [
              { id: 'src/data/courseLoader', label: 'course loading',            type: 'js' },
              { id: 'src/data/majorLoader',  label: 'majorLoader + minorLoader', type: 'js' },
              { id: 'src/data/persistence',  label: 'persistence.js',            type: 'js' }
            ]
          },
          {
            id: 'src/ui', label: 'ui/', type: 'dir',
            children: [
              { id: 'src/ui/Header',     label: 'Header.jsx',           type: 'jsx' },
              { id: 'src/ui/BankPanel',  label: 'BankPanel.jsx',        type: 'jsx' },
              { id: 'src/ui/GradPanel',  label: 'GradPanel.jsx',        type: 'jsx' },
              { id: 'src/ui/SemRow',     label: 'SemRow + SummerRow',   type: 'jsx' },
              { id: 'src/ui/CourseCard', label: 'CourseCard.jsx',       type: 'jsx' },
              { id: 'src/ui/InfoPanel',  label: 'InfoPanel + RelLines', type: 'jsx' }
            ]
          }
        ]
      },
      {
        id: 'dev-portal', label: 'dev-portal/', type: 'dir',
        children: [
          { id: 'dev-portal/catalog-check', label: 'catalog-check', type: 'js' },
          { id: 'dev-portal/nupath-update', label: 'nupath-update', type: 'js' }
        ]
      },
      { id: 'maintenance', label: 'maintenance/', type: 'dir', children: [] }
    ]
  };

  function getPageId() {
    return document.body.getAttribute('data-page') || '';
  }

  function getRoot() {
    var pageId = getPageId();
    if (!pageId) return './';
    var depth = pageId.split('/').length;
    var r = '';
    for (var i = 0; i < depth; i++) r += '../';
    return r;
  }

  function makeHref(id, root) {
    if (id === '') return root;
    return root + id + '/';
  }

  function isAncestorOf(ancestor, descendant) {
    if (ancestor === '') return true;
    return descendant === ancestor || descendant.indexOf(ancestor + '/') === 0;
  }

  function fileBadge(type) {
    if (type === 'jsx') return '<span class="ft ft-jsx">.jsx</span> ';
    if (type === 'js')  return '<span class="ft ft-js">.js</span> ';
    return '';
  }

  function renderNode(node, currentPage, root, depth) {
    var isActive = node.id === currentPage;
    var isOpen   = isAncestorOf(node.id, currentPage);
    var indent   = depth * 12;
    var link     = makeHref(node.id, root);

    if (node.children && node.children.length > 0) {
      var childHtml = '';
      for (var i = 0; i < node.children.length; i++) {
        childHtml += renderNode(node.children[i], currentPage, root, depth + 1);
      }
      return '<details class="nav-folder"' + (isOpen ? ' open' : '') + ' style="margin-left:' + indent + 'px">'
        + '<summary class="' + (isActive ? 'nav-active' : '') + '">'
        + '<a href="' + link + '" onclick="event.stopPropagation()"><span>' + node.label + '</span></a>'
        + '</summary>'
        + childHtml
        + '</details>';
    }

    return '<a href="' + link + '" class="nav-leaf' + (isActive ? ' nav-active' : '') + '" style="padding-left:' + (indent + 20) + 'px">'
      + fileBadge(node.type) + node.label
      + '</a>';
  }

  function init() {
    var root = getRoot();

    // Patch brand text
    var brandName = document.querySelector('.brand-name');
    if (brandName) brandName.textContent = 'nu-map/documentation';
    var brandSub = document.querySelector('.brand-sub');
    if (brandSub) brandSub.textContent = 'developer reference';

    // Replace brand logo div with actual logo image
    var brandLogo = document.querySelector('.brand-logo');
    if (brandLogo) {
      var img = document.createElement('img');
      img.src = root + '../logo.png';
      img.alt = 'nu-map';
      img.className = 'brand-logo-img';
      brandLogo.parentNode.replaceChild(img, brandLogo);
    }

    // Render nav tree
    var container = document.getElementById('nav-tree');
    if (container) {
      var currentPage = getPageId();
      container.innerHTML = renderNode(TREE, currentPage, root, 0);
    }

    // Fix back link
    var backLink = document.getElementById('nav-back');
    if (backLink) {
      backLink.href = 'https://nayugu.github.io/nu-map/';
      backLink.textContent = '\u2190 back to nu-map';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
