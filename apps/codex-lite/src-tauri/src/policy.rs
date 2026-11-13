use reqwest::{redirect::Policy, Client};
use serde::Deserialize;
use std::{sync::LazyLock, time::Duration};
use url::Url;

const PRODUCT: &str = "codex-lite";
static MODEL_ID: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$").expect("valid model ID pattern")
});
static GPT_ID: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)^gpt-?[0-9][a-z0-9._-]*$").expect("valid GPT pattern")
});

#[derive(Deserialize)]
struct Envelope<T> {
    code: i64,
    data: T,
}

#[derive(Deserialize)]
struct Catalog {
    models: Vec<CatalogModel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogModel {
    id: String,
    provider: String,
    api_format: Option<String>,
    responses_compatible: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCredential {
    pub gateway_token: String,
    pub inference_base_url: Option<String>,
    pub expires_at: Option<String>,
}

pub struct AuthorizedCredential {
    pub token: String,
    pub inference_base_url: String,
    pub allowed_model_ids: Vec<String>,
}

pub fn valid_model_id(model_id: &str) -> bool {
    model_id.len() <= 200 && MODEL_ID.is_match(model_id)
}

fn supports_codex(model: &CatalogModel) -> bool {
    if !valid_model_id(&model.id) || model.responses_compatible == Some(false) {
        return false;
    }
    match model.provider.as_str() {
        "openai" => {
            GPT_ID.is_match(&model.id)
                && model
                    .api_format
                    .as_deref()
                    .is_none_or(|format| format == "openai_responses")
        }
        "openai-compatible" => model.api_format.as_deref() == Some("openai_responses"),
        _ => false,
    }
}

pub fn validate_api_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "API 地址无效".to_string())?;
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host == "[::1]"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址必须是 HTTPS，或本机开发服务地址".to_string());
    }
    Ok(url)
}

fn normalize_inference_base_url(value: &str) -> Result<String, String> {
    let url = validate_api_url(value)?;
    let value = url.as_str().trim_end_matches('/');
    Ok(if value.ends_with("/v1") {
        value.to_string()
    } else {
        format!("{value}/v1")
    })
}

fn endpoint(base: &Url, path: &str) -> Result<Url, String> {
    Url::parse(&format!("{}{}", base.as_str().trim_end_matches('/'), path))
        .map_err(|_| "API 地址无效".to_string())
}

async fn read_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Lite 服务请求失败（HTTP {}）", status.as_u16()));
    }
    let envelope: Envelope<T> = response
        .json()
        .await
        .map_err(|_| "Lite 服务返回格式无效".to_string())?;
    if envelope.code != 0 {
        return Err("Lite 服务拒绝了请求，请刷新账户后重试".to_string());
    }
    Ok(envelope.data)
}

pub async fn authorize_launch(
    api_base_url: &str,
    access_token: &str,
    model_id: &str,
    gateway_credential: Option<GatewayCredential>,
) -> Result<AuthorizedCredential, String> {
    if !valid_model_id(model_id) {
        return Err("模型标识无效".to_string());
    }
    if access_token.is_empty() || access_token.contains(['\r', '\n']) {
        return Err("请先登录 Lite 账户".to_string());
    }
    let base = validate_api_url(api_base_url)?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法初始化 Lite 服务连接".to_string())?;
    let catalog: Catalog = read_response(
        client
            .get(endpoint(&base, "/api/models")?)
            .bearer_auth(access_token)
            .header("X-Coding-Bro-Product", PRODUCT)
            .send()
            .await
            .map_err(|_| "无法连接 Lite 模型服务".to_string())?,
    )
    .await?;
    let model = catalog
        .models
        .iter()
        .find(|entry| entry.id == model_id)
        .ok_or("所选模型不在 Lite 服务目录中，请刷新模型列表")?;
    if !supports_codex(model) {
        return Err("Lite 仅允许 GPT 或明确支持 OpenAI Responses 的兼容模型".to_string());
    }
    let allowed_model_ids = catalog
        .models
        .iter()
        .filter(|model| supports_codex(model))
        .map(|model| model.id.clone())
        .collect();
    // Reuse the account credential held by the SDK. Minting on each launch
    // would revoke credentials already in use by another Codex terminal.
    let credential = gateway_credential.ok_or("请刷新账户运行凭据后重试")?;
    if credential.gateway_token.is_empty() || credential.gateway_token.contains(['\r', '\n']) {
        return Err("账户运行凭据无效，请重新登录".to_string());
    }
    if let Some(expires_at) = credential.expires_at.as_deref() {
        let expiry =
            chrono::DateTime::parse_from_rfc3339(expires_at).map_err(|_| "运行凭据有效期无效")?;
        if expiry <= chrono::Utc::now() + chrono::Duration::seconds(10) {
            return Err("运行凭据已过期，请刷新账户后重试".to_string());
        }
    }
    let inference_base_url = normalize_inference_base_url(
        credential
            .inference_base_url
            .as_deref()
            .unwrap_or(base.as_str()),
    )?;
    Ok(AuthorizedCredential {
        token: credential.gateway_token,
        inference_base_url,
        allowed_model_ids,
    })
}
