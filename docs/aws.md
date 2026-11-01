# Deploy to AWS (ECS Fargate)

Use ECS Fargate behind an Application Load Balancer. Avoid App Runner: it does not support WebSockets, which the voice call needs.

## Run the container locally

```bash
docker compose up --build        # http://localhost:3000, reads server/.env
```

## Push the image to ECR

```bash
export AWS_REGION=eu-central-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/language-teacher

aws ecr create-repository --repository-name language-teacher --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${REPO%/*}
docker buildx build --platform linux/amd64 -t $REPO:latest --push .
```

## Create the service (console is easiest the first time)

1. **Secrets Manager**: store `GEMINI_API_KEY` and `ACCESS_CODE` as secrets.
2. **ECS → Task definition** (Fargate, 0.5 vCPU / 1 GB): container image `$REPO:latest`, port 3000, environment `PORT=3000`, and the two secrets under *secrets* (valueFrom the secret ARNs). The task execution role needs `secretsmanager:GetSecretValue`.
3. **ECS → Cluster → Service** from that task definition, 1 task, with a new Application Load Balancer: HTTP/HTTPS listener to a target group on port 3000, health check path `/api/config`.
4. **Load balancer attributes**: raise *idle timeout* to 3600 s so voice calls are not cut after 60 s.
5. **HTTPS**: request an ACM certificate, add an HTTPS:443 listener, and point your domain at the ALB. The microphone and the PWA only work over HTTPS.

Always set `ACCESS_CODE`, otherwise anyone with the URL can spend your Gemini quota.

To update: rebuild and push the image, then `aws ecs update-service --cluster <c> --service <s> --force-new-deployment`.
