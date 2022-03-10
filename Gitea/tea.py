import requests


class Tea:
    def __init__(self, url, token, org_name):
        self.url = url.rstrip("/")
        self.token = token
        self.org_name = org_name

        self.headers = {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36",
        }

    def getRepos(self):
        repos = []
        page = 1

        while True:
            res = requests.get(
                self.url + f"/api/v1/orgs/{self.org_name}/repos?page={page}",
                headers=self.headers,
            ).json()
            if res:
                for r in res:
                    repos.append(
                        {
                            "name": r["name"],
                            "full_name": r["full_name"],
                            "html_url": r["html_url"],
                        }
                    )
                page += 1
            else:
                break

        return repos

    def createMirror(self, repo, auth):
        res = requests.post(
            self.url + f"/api/v1/repos/migrate",
            json={
                "auth_username": auth["username"],
                "auth_token": auth["token"],
                "clone_addr": repo["clone_url"],
                "description": repo["description"],
                "issues": False,
                "milestones": True,
                "mirror": True,
                "private": repo["private"],
                "pull_requests": True,
                "releases": True,
                "repo_name": repo["name"],
                "repo_owner": self.org_name,
                "wiki": True,
            },
            headers=self.headers,
        )

        try:
            res.json()["id"]
        except Exception:
            print(res.text)
            return False

        return True

    def deleteMirror(self, repo):
        res = requests.delete(
            self.url + f"/api/v1/repos/{self.org_name}/{repo['name']}",
            headers=self.headers,
        )

        return res.status_code == 204
