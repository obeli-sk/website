{% if version is not defined %}
  {% if page is defined %}
    {% set pageorsection = page %}
  {% else %}
    {% set pageorsection = section %}
  {% endif %}
  {% if pageorsection.ancestors[2] is defined %}
    {% set ancestor = pageorsection.ancestors[2] %}
    {% set parts = ancestor | split(pat="/") %}
    {% set version = parts[1] %}
  {% else %}
    {% set version = "latest" %}
  {% endif %}
{% endif %}[{{ title }}](@/docs/{{ version }}/{{ path }})