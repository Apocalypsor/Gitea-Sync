import os

from ghapi.all import GhApi

from Gitea.tea import Tea

gh_username = os.environ["GH_USERNAME"]
gh_token = os.environ["GH_TOKEN"]
tea_url = os.environ["TEA_URL"]
tea_token = os.environ["TEA_TOKEN"]
tea_org = os.environ["TEA_ORG"]

gh_api = GhApi(owner=gh_username, token=gh_token)
tea_api = Tea(
    url=tea_url,
    token=tea_token,
    org_name=tea_org,
)

gh_repos = []
page = 1
while True:
    gh_repo = gh_api.repos.list_for_authenticated_user(
        username=gh_username, type="owner", page=page
    )
    if gh_repo:
        gh_repo = [repo for repo in gh_repo if not repo.archived]
        gh_repos += gh_repo
        page += 1
    else:
        break

sc_repos = []
sc_names = []
for gr in gh_repos:
    sc_repos.append(
        {
            "name": gr.name,
            "full_name:": gr.full_name,
            "clone_url": gr.clone_url,
            "description": gr.description,
            "private": gr.private,
        }
    )
    sc_names.append(gr.name)

print(f"[+] {len(sc_repos)} repos in the source.")

ds_repos = tea_api.getRepos()
ds_names = [d["name"] for d in ds_repos]
print(f"[+] {len(ds_names)} repos in the destination.")

exist_index = []
new_index = []
del_index = []

for i in range(len(sc_repos)):
    if sc_names[i] in ds_names:
        exist_index.append(i)
    else:
        new_index.append(i)

for i in range(len(ds_repos)):
    if ds_names[i] not in sc_names:
        del_index.append(i)


print(f"[+] Creating {len(new_index)} repos...")
for i in new_index:
    if tea_api.createMirror(sc_repos[i], {"username": gh_username, "token": gh_token}):
        print(f"[+] {sc_repos[i]['name']} created successfully.")
    else:
        print(f"[-] {sc_repos[i]['name']} failed to create.")

print(f"[+] Deleting {len(del_index)} repos...")
for i in del_index:
    if tea_api.deleteMirror(ds_repos[i]):
        print(f"[+] {ds_repos[i]['name']} deleted successfully.")
    else:
        print(f"[-] {ds_repos[i]['name']} failed to delete.")

print(f"[+] Unwatch mirror repos...")
tea_api.unwatchMirrors()

print("[+] Done.")
