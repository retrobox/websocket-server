FROM node

ADD . /app

EXPOSE 80

RUN npm i 

ENV HOST 0.0.0.0
ENV PORT 80
ENV JWT_KEY blank
ENV API_ENDPOINT https://api.retrobox.tech

CMD ["node", "/app/app.js"]