{{- define "execution-plane.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "execution-plane.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "execution-plane.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "execution-plane.labels" -}}
app.kubernetes.io/name: {{ include "execution-plane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "execution-plane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "execution-plane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
